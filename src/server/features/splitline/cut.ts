import { boundarySegments, isConnected } from '../../entities/census-block/index.js';
import { cos, sin } from '../../shared/detmath/index.js';
import { DataError } from '../../shared/errors/index.js';
import { EARTH_RADIUS_M, greatCircleDistance, type LonLat } from '../../shared/geo/index.js';
import type { SplitContext } from './context.js';
import type { ScanPool } from './pool.js';
import {
  createScanner, F_BLOCKS, F_ITER, F_LENGTH, F_LOWPOP, F_OFFSET, F_POP, F_SHIFT, F_UNRESOLVED, FIELDS, scanDirections,
  type Piece, type ScanJob,
} from './scan.js';

export { selectLow } from './scan.js';

export interface CutResult {
  readonly low: Int32Array;
  readonly high: Int32Array;
  readonly lowSeats: number;
  readonly highSeats: number;
  readonly angleDeg: number;
  /** Great-circle length of the block-edge border between the two final sides. */
  readonly lengthM: number;
  /** Guide lines evaluated: every angle, once per seat orientation. */
  readonly candidateLines: number;
  /** The guide line's portion inside the piece. */
  readonly spans: readonly (readonly [LonLat, LonLat])[];
  /** Candidates passed over because their sides failed validation. */
  readonly skipped: number;
  /** Blocks whose side changed when stray pieces joined the side around them, and their total population. */
  readonly strayBlocksMoved: number;
  readonly strayPopMoved: number;
  /** Population splits made for the chosen line: 1, plus one per re-count. */
  readonly iterations: number;
  /** How far the re-counts moved the chosen guide line, in meters at the projection center. */
  readonly offsetShiftM: number;
  /** Every candidate line evaluated, in direction then orientation order. */
  readonly candidateStats: readonly CandidateStat[];
  /** The candidates asked for in `CutOptions.trace`, in request order; empty when none were asked for. */
  readonly traces: readonly CandidateTrace[];
}

/** A candidate line to trace: direction k and the seats on its first (low) side. */
export interface CandidateTraceRequest { readonly k: number; readonly lowSeats: number }

/** A connected group of one side's blocks during the strays rule. Block arrays hold block indices. */
export interface TraceGroup {
  readonly blocks: Int32Array;
  readonly pop: number;
  /** Blocks of the group that were already fixed; they stay where they are even when the group is not the main body. */
  readonly fixed: Int32Array;
  /** The side's main body: the group that stays. */
  readonly main: boolean;
}

/** One sweep of the strays rule over a side that was in two or more groups, in the generator's group order. */
export interface TraceSweep {
  readonly side: 0 | 1;
  readonly groups: readonly TraceGroup[];
}

/** One population split of a traced candidate and the strays settling after it. Block arrays hold block indices. */
export interface TracePass {
  /** The first side after this split's walk, held blocks included, before strays settle. */
  readonly walkLow: Int32Array;
  /** Blocks that changed side as strays in this pass. */
  readonly moved: Int32Array;
  /** Blocks held to the first or the second side during this split. */
  readonly fixedLow: Int32Array;
  readonly fixedHigh: Int32Array;
  /** The first side's target population for this walk: the share less the people held on the first side. */
  readonly target: number;
  /** The guide line's portion inside the piece at this split's offset. */
  readonly spans: readonly (readonly [LonLat, LonLat])[];
  /** Each sweep of the strays rule in this pass that found a side in two or more groups, in order. */
  readonly sweeps: readonly TraceSweep[];
}

/** Everything about one candidate line, for explaining a cut. */
export interface CandidateTrace {
  readonly k: number;
  readonly lowSeats: number;
  readonly angleDeg: number;
  /** The first side's target population: piece population x lowSeats / seats. */
  readonly share: number;
  /** The piece's blocks in walk order for this direction (block-id tie-break). */
  readonly order: Int32Array;
  /** One per population split; the last is the one after which nothing moved (or the candidate stopped unresolved). */
  readonly passes: readonly TracePass[];
  readonly low: Int32Array;
  readonly high: Int32Array;
  readonly lengthM: number;
  readonly unresolved: boolean;
}

/** Debug record of one candidate line. */
export interface CandidateStat {
  readonly k: number;
  readonly lowSeats: number;
  readonly lengthM: number;
  readonly strayBlocks: number;
  readonly strayPop: number;
  readonly iterations: number;
  readonly offsetShiftM: number;
  readonly lowPop: number;
  /** Fixed strays were left stranded; the line's sides are not connected. */
  readonly unresolved: boolean;
}

export type SideValidator = (low: Int32Array, high: Int32Array) => boolean;

interface Candidate { k: number; lowSeats: number; offset: number; lengthM: number }

export interface CutOptions {
  /** Evaluate candidate directions on these worker threads; without it, on the calling thread. */
  readonly pool?: ScanPool;
  /** Candidates to record in full on the calling thread after the scan; observation only. */
  readonly trace?: readonly CandidateTraceRequest[];
}

/** How many direction steps a line at index k leans from north-south (k = 0 and k = angleCount are both north-south). */
export const northSouthDistance = (k: number, angleCount: number): number => Math.min(k, angleCount - k);

type TieKey = Pick<Candidate, 'k' | 'lowSeats'>;

/** The tie-break rules in the order they apply, each as a signed difference (negative: p goes first). */
const tieDifferences = (angleCount: number, p: TieKey, q: TieKey): [number, number, number] => [
  northSouthDistance(p.k, angleCount) - northSouthDistance(q.k, angleCount),
  p.k - q.k,
  p.lowSeats - q.lowSeats,
];

/**
 * Which rule decides between two equally long candidates, and which of the two goes first: 1 closer to
 * north-south, 2 smaller direction index, 3 fewer first-side seats. Candidates equal on all three keep a first
 * and report rule 3. compareCandidates is built from the same differences, so the two cannot drift apart.
 */
export function decidingTieRule(angleCount: number): (a: TieKey, b: TieKey) => { first: 'a' | 'b'; rule: 1 | 2 | 3 } {
  return (a, b) => {
    const d = tieDifferences(angleCount, a, b);
    const at = d[0] !== 0 ? 0 : d[1] !== 0 ? 1 : 2;
    return { first: d[at]! <= 0 ? 'a' : 'b', rule: (at + 1) as 1 | 2 | 3 };
  };
}

/**
 * The order candidate lines are tried in: border length, then the tie rules of decidingTieRule. Lengths are
 * rounded to the nearest centimeter and compared as integers, so lengths that round to the same centimeter are
 * equal (on a sphere exact ties only exist up to rounding). Two lengths a hair apart can still straddle a
 * rounding boundary and compare as different.
 */
export function compareCandidates(angleCount: number): (p: Pick<Candidate, 'k' | 'lowSeats' | 'lengthM'>, q: Pick<Candidate, 'k' | 'lowSeats' | 'lengthM'>) => number {
  return (p, q) => {
    const d = tieDifferences(angleCount, p, q);
    return Math.round(p.lengthM * 100) - Math.round(q.lengthM * 100) || d[0] || d[1] || d[2];
  };
}

/**
 * Split a piece (`members`, block indices) holding `seats` seats into two sides, choosing the shortest valid
 * border. Candidates are every direction k < ctx.angleCount crossed with the low-side seat count: a = floor(seats / 2)
 * and b = seats - a, so [a, b] when they differ. When a === b the two orientations are mirror images of each other
 * (same line, sides swapped), so only [a] is scanned. Each candidate is scanned for its offset and border length
 * (in a pool when `opts.pool` is given), then all are sorted with compareCandidates and tried in that order. The
 * first whose sides pass `validate` wins; by default both sides must be connected. Candidates failing validation
 * are counted in `skipped`. If none passes, the DataError after the loop reports that no valid cut exists.
 * Throws a DataError up front for fewer than two seats or two blocks.
 */
export function findCut(ctx: SplitContext, members: Int32Array, seats: number, validate?: SideValidator, opts: CutOptions = {}): CutResult {
  const m = members.length;
  if (seats < 2 || m < 2) throw new DataError('a cut needs at least two seats and two blocks');
  const a = Math.floor(seats / 2), b = seats - a;
  const orientations = a === b ? [a] : [a, b];
  const topo = ctx.topo;
  const ids = Int32Array.from(members);
  const pops = new Float64Array(m);
  let total = 0;
  for (let i = 0; i < m; i++) { pops[i] = ctx.blocks[members[i]!]!.pop; total += pops[i]!; }

  // Adjacency inside the piece, in local positions, with shared border lengths.
  const localOf = new Int32Array(topo.n).fill(-1);
  for (let i = 0; i < m; i++) localOf[members[i]!] = i;
  const lOff = new Int32Array(m + 1);
  for (let i = 0; i < m; i++) {
    const g = members[i]!;
    let d = 0;
    for (let k = topo.adjOffsets[g]!; k < topo.adjOffsets[g + 1]!; k++) if (localOf[topo.adjList[k]!]! >= 0) d++;
    lOff[i + 1] = lOff[i]! + d;
  }
  const lAdj = new Int32Array(lOff[m]!), lLen = new Float64Array(lOff[m]!);
  for (let i = 0, w = 0; i < m; i++) {
    const g = members[i]!;
    for (let k = topo.adjOffsets[g]!; k < topo.adjOffsets[g + 1]!; k++) {
      const j = localOf[topo.adjList[k]!]!;
      if (j >= 0) { lAdj[w] = j; lLen[w] = topo.adjLength[k]!; w++; }
    }
  }

  const segs = boundarySegments(topo, members);
  const sx = new Float64Array(segs.count * 2), sy = new Float64Array(segs.count * 2);
  for (let i = 0; i < segs.count; i++) {
    const pa = ctx.proj.forward([segs.a[2 * i]!, segs.a[2 * i + 1]!]);
    const pb = ctx.proj.forward([segs.b[2 * i]!, segs.b[2 * i + 1]!]);
    sx[2 * i] = pa[0]; sy[2 * i] = pa[1]; sx[2 * i + 1] = pb[0]; sy[2 * i + 1] = pb[1];
  }

  const px = new Float64Array(m), py = new Float64Array(m);
  for (let i = 0; i < m; i++) { px[i] = ctx.px[members[i]!]!; py[i] = ctx.py[members[i]!]!; }
  const piece: Piece = { m, ids, pops, total, px, py, lOff, lAdj, lLen };
  const job: ScanJob = { angleCount: ctx.angleCount, seats, orientations };
  for (const t of opts.trace ?? []) {
    if (!Number.isInteger(t.k) || t.k < 0 || t.k >= ctx.angleCount || !orientations.includes(t.lowSeats)) {
      throw new DataError(`trace asks for k=${t.k}, lowSeats=${t.lowSeats}, which is not a candidate of this cut`);
    }
  }
  let res: Float64Array;
  if (opts.pool) res = opts.pool.scan(piece, job);
  else {
    res = new Float64Array(ctx.angleCount * orientations.length * FIELDS);
    let k = 0;
    scanDirections(piece, job, res, () => k++);
  }

  const candidates: Candidate[] = [];
  const candidateStats: CandidateStat[] = [];
  for (let k = 0; k < ctx.angleCount; k++) {
    orientations.forEach((lowSeats, o) => {
      const at = (k * orientations.length + o) * FIELDS;
      // The scan reports offset shifts in sphere radii (projection units); times EARTH_RADIUS_M gives meters at the projection center.
      candidateStats.push({
        k, lowSeats, lengthM: res[at + F_LENGTH]!, strayBlocks: res[at + F_BLOCKS]!, strayPop: res[at + F_POP]!,
        iterations: res[at + F_ITER]!, offsetShiftM: res[at + F_SHIFT]! * EARTH_RADIUS_M, lowPop: res[at + F_LOWPOP]!,
        unresolved: res[at + F_UNRESOLVED] === 1,
      });
      candidates.push({ k, lowSeats, offset: res[at + F_OFFSET]!, lengthM: res[at + F_LENGTH]! });
    });
  }

  candidates.sort(compareCandidates(ctx.angleCount));

  const check: SideValidator = validate ?? ((lo, hi) => isConnected(topo, lo) && isConnected(topo, hi));
  const side = new Uint8Array(m);
  const scanner = createScanner(piece, job);
  let skipped = 0;
  for (const c of candidates) {
    const th = scanner.setDirection(c.k);
    const e = scanner.evaluate(c.lowSeats, side);
    let nLow = 0;
    for (let i = 0; i < m; i++) if (side[i] === 0) nLow++;
    const low = new Int32Array(nLow), high = new Int32Array(m - nLow);
    for (let i = 0, l = 0, h = 0; i < m; i++) { if (side[i] === 0) low[l++] = members[i]!; else high[h++] = members[i]!; }
    if (check(low, high)) {
      const traces = (opts.trace ?? []).map((t) => traceCandidate(ctx, piece, job, members, sx, sy, t));
      return {
        low, high, lowSeats: c.lowSeats, highSeats: seats - c.lowSeats,
        angleDeg: (c.k * 180) / ctx.angleCount, lengthM: e.lengthM,
        candidateLines: ctx.angleCount * orientations.length,
        spans: spanLength(ctx, sx, sy, th, c.offset).spans, skipped,
        strayBlocksMoved: e.movedBlocks, strayPopMoved: e.movedPop,
        iterations: e.iterations, offsetShiftM: e.offsetShift * EARTH_RADIUS_M, candidateStats, traces,
      };
    }
    skipped++;
  }
  throw new DataError('no straight line produces two connected sides');
}

/** Re-run one candidate on a fresh scanner, recording each split and its settling. */
function traceCandidate(ctx: SplitContext, piece: Piece, job: ScanJob, members: Int32Array, sx: Float64Array, sy: Float64Array, t: CandidateTraceRequest): CandidateTrace {
  const m = piece.m;
  const scanner = createScanner(piece, job);
  const th = scanner.setDirection(t.k);
  const toBlocks = (local: Iterable<number>) => Int32Array.from(local, (i) => members[i]!);
  const where = (n: number, keep: (i: number) => boolean) => {
    const out: number[] = [];
    for (let i = 0; i < n; i++) if (keep(i)) out.push(members[i]!);
    return Int32Array.from(out);
  };
  const passes: TracePass[] = [];
  const side = new Uint8Array(m);
  const e = scanner.evaluate(t.lowSeats, side, (p) => {
    passes.push({
      walkLow: where(m, (i) => p.walk[i] === 0), moved: toBlocks(p.moved),
      fixedLow: where(m, (i) => p.held[i] === 0), fixedHigh: where(m, (i) => p.held[i] === 1),
      target: p.target, spans: spanLength(ctx, sx, sy, th, p.offset).spans,
      sweeps: p.sweeps.map((sw) => ({
        side: sw.side,
        groups: sw.groups.map((g) => ({ blocks: toBlocks(g.positions), pop: g.pop, fixed: toBlocks(g.fixed), main: g.main })),
      })),
    });
  });
  return {
    k: t.k, lowSeats: t.lowSeats, angleDeg: (t.k * 180) / ctx.angleCount,
    share: (piece.total * t.lowSeats) / job.seats, order: toBlocks(scanner.walkOrder()), passes,
    low: where(m, (i) => side[i] === 0), high: where(m, (i) => side[i] === 1),
    lengthM: e.lengthM, unresolved: e.unresolved,
  };
}

/** Great-circle length of the line {p . n = offset} inside the piece, by even-odd pairing of boundary crossings. */
function spanLength(ctx: SplitContext, sx: Float64Array, sy: Float64Array, th: number, offset: number) {
  const nx = cos(th), ny = -sin(th), dx = sin(th), dy = cos(th);
  const ts: number[] = [];
  for (let i = 0; i < sx.length; i += 2) {
    const s1 = sx[i]! * nx + sy[i]! * ny - offset;
    const s2 = sx[i + 1]! * nx + sy[i + 1]! * ny - offset;
    if (s1 < 0 !== s2 < 0) {
      const f = s1 / (s1 - s2);
      const x = sx[i]! + (sx[i + 1]! - sx[i]!) * f, y = sy[i]! + (sy[i + 1]! - sy[i]!) * f;
      ts.push(x * dx + y * dy);
    }
  }
  ts.sort((p, q) => p - q);
  const spans: [LonLat, LonLat][] = [];
  let length = 0;
  for (let i = 0; i + 1 < ts.length; i += 2) {
    const p = ctx.proj.inverse([offset * nx + ts[i]! * dx, offset * ny + ts[i]! * dy]);
    const q = ctx.proj.inverse([offset * nx + ts[i + 1]! * dx, offset * ny + ts[i + 1]! * dy]);
    spans.push([p, q]);
    length += greatCircleDistance(p, q);
  }
  return { length, spans };
}
