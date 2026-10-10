import { boundarySegments, isConnected } from '../../entities/census-block/index.js';
import { cos, sin } from '../../shared/detmath/index.js';
import { DataError } from '../../shared/errors/index.js';
import { EARTH_RADIUS_M, greatCircleDistance, type LonLat } from '../../shared/geo/index.js';
import { Chain } from './chain.js';
import { zob, zob2 } from './hash.js';
import type { SplitContext } from './context.js';
import type { ScanPool } from './pool.js';
import { createScanner, type Piece, type ScanJob } from './scan.js';
import { compareRanges, directionAt, geoFor, mergeChunks, type ChunkResult, type Dir, type Range, type TieSpan } from './sweep.js';
import { chunksFor, runTask, taskCount, type PoolJob, type SweepJob, type TieSpanJob } from './tasks.js';

export { selectLow } from './scan.js';

/** Best ranges each chunk keeps for the final ranking. */
const KEEP = 6;

export interface CutResult {
  readonly low: Int32Array;
  readonly high: Int32Array;
  readonly lowSeats: number;
  readonly highSeats: number;
  /** The direction the guide line is drawn at: the middle of the winning range, in degrees clockwise from north-south. */
  readonly angleDeg: number;
  /** The winning range: every direction in [fromDeg, toDeg) gives these sides (toDeg below fromDeg: it runs across north-south). */
  readonly fromDeg: number;
  readonly toDeg: number;
  /** The winning range runs across north-south (from before 180 degrees on past 0). */
  readonly wraps: boolean;
  /** The winning range is the line slid from the other end (an exact tie of the stopping rule decided the other way). */
  readonly reversed: boolean;
  /** Great-circle length of the block-edge border between the two final sides (whole micrometers, as meters). */
  readonly lengthM: number;
  /** Ranges of directions that gave a distinct result, over both first-side seat counts: every candidate there is. */
  readonly candidateRanges: number;
  /** Of those, ranges of lines slid from the other end, swept only where a stopping-rule tie made them differ. */
  readonly reversedRanges: number;
  /** Stretches swept again from the other end (where some pass sat on a stopping-rule tie). */
  readonly tieSpans: number;
  /** Directions where some population split changed. */
  readonly splitChanges: number;
  /** The guide line's portion inside the piece. */
  readonly spans: readonly (readonly [LonLat, LonLat])[];
  /** Shorter candidates passed over because their sides were not each connected (counted by distinct length), plus any the validator refused. */
  readonly skipped: number;
  /** Blocks whose side changed when stray pieces joined the side around them, and their total population. */
  readonly strayBlocksMoved: number;
  readonly strayPopMoved: number;
  /** Population splits made for the chosen range: 1, plus one per re-count. */
  readonly iterations: number;
  /** How far the re-counts moved the drawn guide line, in meters at the projection center. */
  readonly offsetShiftM: number;
  /** Shorter ranges passed over because their sides were not each connected, in the generator's order. */
  readonly skippedRanges: readonly CandidateRange[];
  /** The leading candidates in the generator's order (the best few of every chunk, joined across chunk edges). */
  readonly candidates: readonly CandidateRange[];
  /** Ranges with the winning border length whose sides passed (1 when nothing tied), and the distinct cuts among them. */
  readonly tiedRanges: number;
  readonly tiedCuts: number;
  /** The candidates asked for in `CutOptions.trace`, in request order; empty when none were asked for. */
  readonly traces: readonly CandidateTrace[];
  /** What the search did, for profiling only: never part of a plan. */
  readonly scan: ScanCounters;
}

/**
 * Work counters of one cut's search, summed over every chunk and tie stretch swept. The counts are the same on any
 * number of threads; `tieSpanMs` is wall-clock time and is not.
 */
export interface ScanCounters {
  /** Wall-clock time spent sweeping the tie stretches again from the other end. */
  readonly tieSpanMs: number;
  /** Trackers derived from a neighbouring pass instead of built from scratch. */
  readonly derivedBuilds: number;
  /** Trackers re-aimed at a new target in place. */
  readonly reconfigs: number;
  /** Signs the exact arithmetic decided in integers because rounded arithmetic was too close to call. */
  readonly exactFallbacks: number;
}

/** One candidate: a range of directions that all give the same sides. */
export interface CandidateRange {
  readonly lowSeats: number;
  readonly fromDeg: number;
  readonly toDeg: number;
  readonly lengthM: number;
  readonly lowPop: number;
  /** The exact directions bounding the range, for exact comparisons. */
  readonly from: Dir;
  readonly to: Dir;
  /** The range runs across north-south (from before 180 degrees on past 0), so it contains north-south. */
  readonly wraps: boolean;
  /** The line slid from the other end (see CutResult.reversed). */
  readonly reversed: boolean;
}

/** A candidate line to trace: a direction (degrees clockwise from north-south) and the seats on its first (low) side. */
export interface CandidateTraceRequest {
  readonly angleDeg: number;
  readonly lowSeats: number;
  /** The line slid from the other end (a candidate with `reversed`): the stopping rule's exact ties go the other way. */
  readonly reversed?: boolean;
}

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

export type SideValidator = (low: Int32Array, high: Int32Array) => boolean;

export interface CutOptions {
  /** Sweep the chunks of directions on these worker threads; without it, on the calling thread. */
  readonly pool?: ScanPool;
  /**
   * Sweep every line slid from the other end over the whole half turn, not only where a stopping-rule tie was found.
   * A check that the ties found are all there are: the cut must come out the same. Slow; for tests.
   */
  readonly reverseEverywhere?: boolean;
  /** Cut the half turn into this many chunks instead of chunksFor(m). The cut must not change; for tests. */
  readonly chunks?: number;
  /** Candidates to record in full on the calling thread after the scan; observation only. */
  readonly trace?: readonly CandidateTraceRequest[];
}

/**
 * One way of cutting a piece, as the tie rules see it. `gap` is how far the sides are from their fair shares of
 * people: |first side's people x seats - piece people x first side's seats|, a whole number, the same counted from
 * either side (seats times the people the first side is over or under its share). `side` is the side holding the
 * piece's lowest GEOID (block indices are in GEOID order), as ascending block indices, and `seats` the seats that
 * side gets. Two ranges give the same cut exactly when their `side` and `seats` are equal, whichever side each calls first.
 */
export interface CutSides { readonly gap: number; readonly side: Int32Array; readonly seats: number }

/** The tie-rule key of a cut: `low` and `high` are block indices, `lowSeats` and `lowPop` the first side's seats and people. */
export function cutSides(low: Int32Array, high: Int32Array, lowSeats: number, seats: number, lowPop: number, total: number): CutSides {
  let minLow = Infinity, minHigh = Infinity;
  for (const i of low) if (i < minLow) minLow = i;
  for (const i of high) if (i < minHigh) minHigh = i;
  const [side, n] = minLow < minHigh ? [low, lowSeats] : [high, seats - lowSeats];
  return { gap: Math.abs(lowPop * seats - total * lowSeats), side: Int32Array.from(side).sort(), seats: n };
}

/**
 * The tie rules between two cuts with exactly equal borders (negative: p is used). First the sides nearer their fair
 * shares of people (smaller `gap`). Then GEOID: each cut's side holding the piece's lowest GEOID is listed in GEOID
 * order and the two lists are read together; at the first GEOID where they differ, the cut whose list has that GEOID
 * (the lower one there) is used; a list that ends first loses, since the other holds a GEOID it lacks. Equivalently,
 * the lowest GEOID on which the two cuts disagree goes with the piece's lowest GEOID. Equal lists are the same two
 * sides; then fewer seats on that side, and 0 for the same cut.
 */
export function compareCutSides(p: CutSides, q: CutSides): number {
  if (p.gap !== q.gap) return p.gap < q.gap ? -1 : 1;
  return compareGeoidSides(p, q);
}

/** The GEOID part of compareCutSides alone; 0 exactly when the two are the same cut. */
export function compareGeoidSides(p: Pick<CutSides, 'side' | 'seats'>, q: Pick<CutSides, 'side' | 'seats'>): number {
  const a = p.side, b = q.side, n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return a[i]! < b[i]! ? -1 : 1;
  if (a.length !== b.length) return a.length > b.length ? -1 : 1;
  return p.seats - q.seats;
}

/** Where a range ends, in [0, 180]; below its start when the range runs across north-south. */
const endDeg = (r: Range): number => (r.wraps ? r.eDeg - 180 : r.eDeg);

const toCandidate = (r: Range): CandidateRange => ({
  lowSeats: r.lowSeats, fromDeg: r.sDeg, toDeg: endDeg(r),
  lengthM: r.lengthUm / 1e6, lowPop: r.lowPop, from: r.s, to: r.e, wraps: r.wraps === true, reversed: r.reversed === true,
});

/**
 * Tie stretches of all chunks, per first-side seat count, with the pieces a chunk edge split joined back together, so
 * the stretches (and the ranges swept again inside them) do not depend on how the half turn was cut into chunks.
 */
function joinTieSpans(chunks: readonly ChunkResult[]): { lowSeats: number; ties: TieSpan[] }[] {
  const by = new Map<number, TieSpan[]>();
  for (const c of chunks) by.set(c.lowSeats, [...(by.get(c.lowSeats) ?? []), ...c.ties]);
  const same = (a: Dir, b: Dir) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
  return [...by].sort((p, q) => p[0] - q[0]).map(([lowSeats, list]) => {
    const ties: TieSpan[] = [];
    for (const t of [...list].sort((p, q) => p.sDeg - q.sDeg)) {
      const prev = ties[ties.length - 1];
      if (prev && prev.eDeg === t.sDeg && same(prev.e, t.s)) ties[ties.length - 1] = { ...prev, e: t.e, eDeg: t.eDeg, endIsPi: t.endIsPi };
      else ties.push(t);
    }
    return { lowSeats, ties };
  });
}

/** Every task of a job, in task order: on the pool when there is one, otherwise on the calling thread. */
function runAll(piece: Piece, job: PoolJob, pool: ScanPool | undefined): ChunkResult[] {
  if (pool) return pool.scan(piece, job);
  const out: ChunkResult[] = [];
  for (let t = 0; t < taskCount(job); t++) out.push(runTask(piece, job, t));
  return out;
}

/** A work counter summed over the sweeps' stats (0 where a sweep did not count it). */
const statSum = (sweeps: readonly ChunkResult[], key: string): number => sweeps.reduce((s, c) => s + (c.stats[key] ?? 0), 0);

/** The piece turned half way round: every point negated (exact), so a sweep of it slides each line from the other end. */
function mirrorPiece(piece: Piece): Piece {
  return { ...piece, px: piece.px.map((v) => -v), py: piece.py.map((v) => -v) };
}

/** The piece for one cut: local positions, adjacency inside the piece, shared edge lengths in whole micrometers. */
function buildPiece(ctx: SplitContext, members: Int32Array): Piece {
  const topo = ctx.topo, m = members.length;
  const ids = Int32Array.from(members);
  const pops = new Float64Array(m);
  let total = 0;
  for (let i = 0; i < m; i++) { pops[i] = ctx.blocks[members[i]!]!.pop; total += pops[i]!; }
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
      // Whole micrometers, so every sum of edge lengths is exact whatever the order of addition.
      if (j >= 0) { lAdj[w] = j; lLen[w] = Math.round(topo.adjLength[k]! * 1e6); w++; }
    }
  }
  const px = new Float64Array(m), py = new Float64Array(m);
  for (let i = 0; i < m; i++) { px[i] = ctx.px[members[i]!]!; py[i] = ctx.py[members[i]!]!; }
  return { m, ids, pops, total, px, py, lOff, lAdj, lLen };
}

/** The evaluation just after direction `s` (exact): the sides every direction of a range starting at `s` gives. */
function evaluateAt(piece: Piece, seats: number, lowSeats: number, s: Dir): Chain {
  const chain = new Chain(piece, geoFor(piece, s, [0, 0, 0, -1], true), seats, lowSeats);
  chain.start(-4, -2);
  return chain;
}

/**
 * Split a piece (`members`, block indices) holding `seats` seats into two sides along the shortest valid border
 * over every straight line. The first side gets a = floor(seats / 2) or b = seats - a seats ([a, b] when they
 * differ; when a === b the two are mirror images, so only [a] is swept). For each, the half turn of directions is
 * swept exactly (sweep.ts): the directions fall into ranges that all give the same sides, and every range is
 * evaluated once. The ranges are tried shortest border first; of those with the shortest border whose sides pass
 * `validate`, the cut is chosen by people, then GEOID (compareCutSides) (by default both sides must be connected, which every resolved range already is). Throws a
 * DataError up front for fewer than two seats or two blocks, and when no range passes.
 */
export function findCut(ctx: SplitContext, members: Int32Array, seats: number, validate?: SideValidator, opts: CutOptions = {}): CutResult {
  const m = members.length;
  if (seats < 2 || m < 2) throw new DataError('a cut needs at least two seats and two blocks');
  const a = Math.floor(seats / 2), b = seats - a;
  const orientations = a === b ? [a] : [a, b];
  const topo = ctx.topo;
  const piece = buildPiece(ctx, members);
  for (const t of opts.trace ?? []) {
    if (!(t.angleDeg >= 0 && t.angleDeg < 180) || !orientations.includes(t.lowSeats)) {
      throw new DataError(`trace asks for ${t.angleDeg} degrees, lowSeats=${t.lowSeats}, which is not a candidate of this cut`);
    }
  }

  const job: SweepJob = { seats, orientations, chunks: opts.chunks ?? chunksFor(m), keep: KEEP };
  const chunks = runAll(piece, job, opts.pool);
  // Fingerprints of every block, so the two ends of the half turn can be recognised as one range (sides swapped).
  let h1 = 0, h2 = 0;
  for (let i = 0; i < m; i++) { h1 ^= zob(i); h2 ^= zob2(i); }
  const merged = mergeChunks(chunks, { h1: h1 >>> 0, h2: h2 >>> 0 });
  // The same lines slid from the other end. A line is the same line at a direction and half a turn on, but the
  // stopping rule fills the first side from its own end, so an exact tie (stopping before or after a block equally
  // near the share, or an empty block next to a side exactly on its share) is decided the other way. That is only
  // possible where some pass sat on such a tie, so only those stretches are swept again, on the piece turned half way
  // round (every point negated, exact) with the other side first: the line from the other end.
  // Built only when some stretch needs the line from the other end (sidesOf and the winner read it only then).
  let turned: Piece | undefined;
  const flippedPiece = (): Piece => (turned ??= mirrorPiece(piece));
  const reversed: Range[] = [];
  let reversedCount = 0;
  const spans = opts.reverseEverywhere
    ? orientations.map((o) => ({ lowSeats: o, ties: [{ s: directionAt(0), e: directionAt(180), sDeg: 0, eDeg: 180, endIsPi: true }] }))
    : joinTieSpans(chunks);
  // Each stretch is one task, whole, swept on the pool when there is one; the results are taken in stretch order.
  const tieJob: TieSpanJob = {
    kind: 'tieSpan', seats, keep: KEEP,
    spans: spans.flatMap((c) => c.ties.map((t) => ({ lowSeats: seats - c.lowSeats, s: t.s, e: t.e, sDeg: t.sDeg, eDeg: t.eDeg, endIsPi: t.endIsPi }))),
  };
  const tieSpans = tieJob.spans.length;
  const tieT0 = performance.now();
  const tieResults = tieSpans === 0 ? [] : runAll(flippedPiece(), tieJob, opts.pool);
  const tieSpanMs = performance.now() - tieT0;
  for (const res of tieResults) {
    reversedCount += res.resultRanges;
    for (const r of new Set([res.first, res.last, ...res.top])) if (!r.unresolved) reversed.push({ ...r, reversed: true });
  }
  const sweeps = [...chunks, ...tieResults];
  // Listing order is stable, so a reversed range starting where an ordinary one does stays behind it.
  const ranges = [...merged.ranges, ...reversed].sort(compareRanges);

  const check: SideValidator = validate ?? ((lo, hi) => isConnected(topo, lo) && isConnected(topo, hi));
  /** The sides every direction of range `r` gives, re-evaluated exactly and checked against the sweep's fingerprints. */
  const sidesOf = (r: Range) => {
    const chain = evaluateAt(r.reversed ? flippedPiece() : piece, seats, r.lowSeats, r.at ?? r.s);
    if (chain.lengthUm !== r.lengthUm || chain.h1 !== r.h1 || chain.h2 !== r.h2 || chain.unresolved) {
      throw new DataError(`the range from ${r.sDeg} degrees re-evaluates to different sides`);
    }
    const side = chain.finalSides();
    let nLow = 0;
    for (let i = 0; i < m; i++) if (side[i] === 0) nLow++;
    const low = new Int32Array(nLow), high = new Int32Array(m - nLow);
    for (let i = 0, l = 0, h = 0; i < m; i++) { if (side[i] === 0) low[l++] = members[i]!; else high[h++] = members[i]!; }
    return { chain, side, low, high };
  };
  let refused = 0;
  for (let ri = 0; ri < ranges.length;) {
    // Every range with this border length, all evaluated: the shortest border is the rule, and equal borders are
    // decided by people, then GEOID (compareCutSides), never by direction.
    const group0 = ri;
    const lengthUm = ranges[ri]!.lengthUm;
    const passed: { r: Range; at: number; ev: ReturnType<typeof sidesOf>; key: CutSides }[] = [];
    for (; ri < ranges.length && ranges[ri]!.lengthUm === lengthUm; ri++) {
      const r = ranges[ri]!;
      const ev = sidesOf(r);
      if (!check(ev.low, ev.high)) { refused++; continue; }
      passed.push({ r, at: ri, ev, key: cutSides(ev.low, ev.high, r.lowSeats, seats, ev.chain.lowPop, piece.total) });
    }
    if (!passed.length) continue;
    // The cut by the tie rules; of the ranges giving that same cut, the first listed is drawn (strict <, so the first stays).
    let win = passed[0]!;
    for (const p of passed) if (compareCutSides(p.key, win.key) < 0) win = p;
    const distinct: CutSides[] = [];
    for (const p of passed) if (!distinct.some((d) => compareCutSides(d, p.key) === 0)) distinct.push(p.key);
    const r = win.r, { chain, side, low, high } = win.ev;
    // The winner leads the candidate list, ahead of the other ranges of its length.
    const listed = [...ranges];
    listed.splice(win.at, 1);
    listed.splice(group0, 0, r);
    const candidates = listed.slice(0, 200).map(toCandidate);

    // Shorter unresolved ranges, counted once per distinct length (a range cut by a chunk edge has one length).
    const skippedRanges = chunks.flatMap((c) => c.unresolvedRanges.filter((u) => u.lengthUm < r.lengthUm)).sort(compareRanges).map(toCandidate);
    const shorterUnresolved = new Set<number>();
    for (const c of chunks) for (const u of c.unresolvedBelow) if (u < r.lengthUm) shorterUnresolved.add(u);
    const { sx, sy } = boundaryInPlane(ctx, members);
    // The middle of the range; for a range across north-south, measured on through 180 degrees and reported in [0, 180).
    const midDeg = (r.sDeg + r.eDeg) / 2;
    const angleDeg = midDeg >= 180 ? midDeg - 180 : midDeg;
    // The offset is measured in the frame the sides were evaluated in: for a range across north-south that is the part
    // after 0 degrees, so the middle is taken 180 degrees back (the same line, with the sides the right way round).
    const th = ((r.wraps ? midDeg - 180 : midDeg) * Math.PI) / 180;
    const last = chain.passes[chain.passes.length - 1]!, first = chain.passes[0]!;
    // A reversed range was evaluated on the piece turned half way round, so its offsets come back negated.
    const [frame, sign] = r.reversed ? [flippedPiece(), -1] : [piece, 1];
    const offset = sign * splitOffset(frame, th, (i) => last.fixedBefore[i]! < 0, (i) => side[i] === 0);
    const offset0 = sign * splitOffset(frame, th, () => true, (i) => first.side[i] === 0);
    let movedPop = 0;
    for (let i = 0; i < m; i++) if (last.fixedBefore[i]! >= 0) movedPop += piece.pops[i]!;
    const traces = (opts.trace ?? []).map((t) => traceCandidate(ctx, t.reversed ? flippedPiece() : piece, t.reversed ? -1 : 1, seats, members, sx, sy, t));
    return {
      low, high, lowSeats: r.lowSeats, highSeats: seats - r.lowSeats,
      angleDeg, fromDeg: r.sDeg, toDeg: endDeg(r), wraps: r.wraps === true, reversed: r.reversed === true, lengthM: r.lengthUm / 1e6,
      candidateRanges: merged.count + reversedCount, reversedRanges: reversedCount, tieSpans, splitChanges: chunks.reduce((s, c) => s + c.splitChanges, 0),
      spans: spanLength(ctx, sx, sy, th, offset).spans, skipped: shorterUnresolved.size + refused, skippedRanges,
      strayBlocksMoved: chain.movedBlocks, strayPopMoved: movedPop,
      iterations: chain.passes.length, offsetShiftM: (offset - offset0) * EARTH_RADIUS_M, candidates, traces,
      tiedRanges: passed.length, tiedCuts: distinct.length,
      scan: {
        tieSpanMs, derivedBuilds: statSum(sweeps, 'derivedBuilds'), reconfigs: statSum(sweeps, 'reconfigs'), exactFallbacks: statSum(sweeps, 'exactFallbacks'),
      },
    };
  }
  throw new DataError('no straight line produces two connected sides');
}

/**
 * The trace request for a cut's own line, and whether the trace's sides come out swapped. A range across north-south
 * (toDeg below fromDeg) takes its sides, and its first-side seats, from its part after 0 degrees. Its drawn middle can
 * lie in its part before 180, where the same line has its sides the other way round: that line is traced there with
 * the mirror seat count, and its first side is the cut's second side. (Tracing 180 degrees back instead would slide
 * the line from the other end, which differs on a stopping-rule tie.)
 */
export function cutTraceRequest(c: { readonly angleDeg: number; readonly fromDeg: number; readonly toDeg: number; readonly seats: number; readonly lowSeats: number; readonly wraps?: boolean; readonly reversed?: boolean }): { request: CandidateTraceRequest; swapped: boolean } {
  // Drawn at 0 exactly means the middle is 180 itself, the part after 0 (a range that covers the whole half turn).
  const swapped = (c.wraps ?? c.toDeg < c.fromDeg) && c.angleDeg >= c.fromDeg && !(c.angleDeg === 0 && c.fromDeg === 0);
  return { request: { angleDeg: c.angleDeg, lowSeats: swapped ? c.seats - c.lowSeats : c.lowSeats, reversed: c.reversed === true }, swapped };
}

/** One line traced in full without searching for the cut (as CutOptions.trace records it); observation only. */
export function traceLine(ctx: SplitContext, members: Int32Array, seats: number, t: CandidateTraceRequest): CandidateTrace {
  const piece = buildPiece(ctx, members);
  const { sx, sy } = boundaryInPlane(ctx, members);
  return traceCandidate(ctx, t.reversed ? mirrorPiece(piece) : piece, t.reversed ? -1 : 1, seats, members, sx, sy, t);
}

/** The piece's outline in the projection plane, as segment endpoint pairs. */
function boundaryInPlane(ctx: SplitContext, members: Int32Array) {
  const segs = boundarySegments(ctx.topo, members);
  const sx = new Float64Array(segs.count * 2), sy = new Float64Array(segs.count * 2);
  for (let i = 0; i < segs.count; i++) {
    const pa = ctx.proj.forward([segs.a[2 * i]!, segs.a[2 * i + 1]!]);
    const pb = ctx.proj.forward([segs.b[2 * i]!, segs.b[2 * i + 1]!]);
    sx[2 * i] = pa[0]; sy[2 * i] = pa[1]; sx[2 * i + 1] = pb[0]; sy[2 * i + 1] = pb[1];
  }
  return { sx, sy };
}

/** Guide-line offset at angle th: halfway between the last first-side key and the first second-side key among the given blocks. */
function splitOffset(piece: Piece, th: number, take: (i: number) => boolean, isLow: (i: number) => boolean): number {
  const nx = cos(th), ny = -sin(th);
  let maxLow = -Infinity, minHigh = Infinity;
  for (let i = 0; i < piece.m; i++) {
    if (!take(i)) continue;
    const k = piece.px[i]! * nx + piece.py[i]! * ny;
    if (isLow(i)) { if (k > maxLow) maxLow = k; } else if (k < minHigh) minHigh = k;
  }
  return maxLow === -Infinity ? minHigh : minHigh === Infinity ? maxLow : (maxLow + minHigh) / 2;
}

/** Re-run one candidate on a fresh scanner at the given angle, recording each split and its settling. */
/** `piece` is the turned piece for a reversed request; `sign` (-1 then) turns its offsets back. */
function traceCandidate(ctx: SplitContext, piece: Piece, sign: number, seats: number, members: Int32Array, sx: Float64Array, sy: Float64Array, t: CandidateTraceRequest): CandidateTrace {
  const m = piece.m;
  const job: ScanJob = { seats };
  const scanner = createScanner(piece, job);
  const th = scanner.setAngle(t.angleDeg);
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
      target: p.target, spans: spanLength(ctx, sx, sy, th, sign * p.offset).spans,
      sweeps: p.sweeps.map((sw) => ({
        side: sw.side,
        groups: sw.groups.map((g) => ({ blocks: toBlocks(g.positions), pop: g.pop, fixed: toBlocks(g.fixed), main: g.main })),
      })),
    });
  });
  return {
    lowSeats: t.lowSeats, angleDeg: t.angleDeg,
    share: (piece.total * t.lowSeats) / seats, order: toBlocks(scanner.walkOrder()), passes,
    low: where(m, (i) => side[i] === 0), high: where(m, (i) => side[i] === 1),
    lengthM: e.lengthM / 1e6, unresolved: e.unresolved,
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
