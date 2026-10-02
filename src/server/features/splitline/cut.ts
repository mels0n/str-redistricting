import { boundarySegments, isConnected } from '../../entities/census-block/index.js';
import { cos, sin } from '../../shared/detmath/index.js';
import { DataError } from '../../shared/errors/index.js';
import { greatCircleDistance, type LonLat } from '../../shared/geo/index.js';
import type { SplitContext } from './context.js';
import type { ScanPool } from './pool.js';
import { createScanner, F_LENGTH, F_OFFSET, F_POP, FIELDS, scanDirections, type Piece, type ScanJob } from './scan.js';

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
  /** Candidates passed over: guide lines over the stray cap, plus sides that failed validation. */
  readonly skipped: number;
  /** Guide lines rejected because their strays hold more than 1% of the piece's ideal district population (included in skipped). */
  readonly strayCapRejected: number;
  /** Blocks whose side changed when stray pieces joined the side around them, and their total population. */
  readonly strayBlocksMoved: number;
  readonly strayPopMoved: number;
}

export type SideValidator = (low: Int32Array, high: Int32Array) => boolean;

interface Candidate { k: number; lowSeats: number; offset: number; lengthM: number }

export interface CutOptions {
  /** Evaluate candidate directions on these worker threads; without it, on the calling thread. */
  readonly pool?: ScanPool;
}

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
  let res: Float64Array;
  if (opts.pool) res = opts.pool.scan(piece, job);
  else {
    res = new Float64Array(ctx.angleCount * orientations.length * FIELDS);
    let k = 0;
    scanDirections(piece, job, res, () => k++);
  }

  const candidates: Candidate[] = [];
  let strayCapRejected = 0;
  for (let k = 0; k < ctx.angleCount; k++) {
    orientations.forEach((lowSeats, o) => {
      const at = (k * orientations.length + o) * FIELDS;
      // Stray cap: strays may hold at most 1% of the piece's ideal district population (pop / seats).
      // Populations are integers, so this form of the comparison is exact.
      if (res[at + F_POP]! * 100 * seats > total) { strayCapRejected++; return; }
      candidates.push({ k, lowSeats, offset: res[at + F_OFFSET]!, lengthM: res[at + F_LENGTH]! });
    });
  }

  const nsDist = (k: number) => Math.min(k, ctx.angleCount - k);
  // Lengths within a centimeter count as equal: on a sphere exact ties only exist up to rounding.
  const cm = (c: Candidate) => Math.round(c.lengthM * 100);
  candidates.sort((p, q) => cm(p) - cm(q) || nsDist(p.k) - nsDist(q.k) || p.k - q.k || p.lowSeats - q.lowSeats);

  const check: SideValidator = validate ?? ((lo, hi) => isConnected(topo, lo) && isConnected(topo, hi));
  const side = new Uint8Array(m);
  const scanner = createScanner(piece, job);
  let skipped = strayCapRejected;
  for (const c of candidates) {
    const th = scanner.setDirection(c.k);
    const e = scanner.evaluate(c.lowSeats, side);
    let nLow = 0;
    for (let i = 0; i < m; i++) if (side[i] === 0) nLow++;
    const low = new Int32Array(nLow), high = new Int32Array(m - nLow);
    for (let i = 0, l = 0, h = 0; i < m; i++) { if (side[i] === 0) low[l++] = members[i]!; else high[h++] = members[i]!; }
    if (check(low, high)) {
      return {
        low, high, lowSeats: c.lowSeats, highSeats: seats - c.lowSeats,
        angleDeg: (c.k * 180) / ctx.angleCount, lengthM: e.lengthM,
        candidateLines: ctx.angleCount * orientations.length,
        spans: spanLength(ctx, sx, sy, th, c.offset).spans, skipped, strayCapRejected,
        strayBlocksMoved: e.movedBlocks, strayPopMoved: e.movedPop,
      };
    }
    skipped++;
  }
  throw new DataError('no straight line meets the stray cap and produces two connected sides');
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
