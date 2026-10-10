import { signOfAbsDifference, signOfDifference } from '../../shared/exact/index.js';
import { atan2, cos, sin } from '../../shared/detmath/index.js';
import { Chain } from './chain.js';
import type { Piece } from './scan.js';
import { X, Y, type Geo } from './tracker.js';

/**
 * A direction as the two points that define it, (x2 - x1, y2 - y1): the original doubles, so comparisons stay
 * exact. A range's start is either an event (the segment between two blocks' points) or a chunk boundary.
 */
export type Dir = readonly [x1: number, y1: number, x2: number, y2: number];

/** One stretch of directions [s, e) that all give the same final sides. */
export interface Range {
  readonly s: Dir;
  readonly e: Dir;
  readonly sDeg: number;
  readonly eDeg: number;
  /** Border length in whole micrometres (exact) and in meters (for reporting). */
  readonly lengthUm: number;
  readonly lowPop: number;
  readonly h1: number;
  readonly h2: number;
  readonly unresolved: boolean;
  readonly lowSeats: number;
  /** 1 when this range starts at its chunk's start, 2 when it ends at its chunk's end (3 for both). */
  readonly edge: number;
}

export interface ChunkResult {
  readonly lowSeats: number;
  readonly aDeg: number;
  readonly bDeg: number;
  /** The chunk's best resolved ranges in generator order, plus its first and last range (which may continue in a neighbouring chunk). */
  readonly top: readonly Range[];
  readonly first: Range;
  readonly last: Range;
  /** Distinct lengths (whole micrometres) of the chunk's unresolved ranges shorter than its best resolved range, ascending. */
  readonly unresolvedBelow: readonly number[];
  /** The unresolved ranges behind unresolvedBelow, in generator order (a range cut by a chunk edge appears once per chunk). */
  readonly unresolvedRanges: readonly Range[];
  /** Directions where some pass's split changed, and where the final sides changed. */
  readonly splitChanges: number;
  readonly resultRanges: number;
  readonly stats: Readonly<Record<string, number>>;
}

const sgn = (d: Dir): number => {
  const dx = d[2] - d[0];
  if (dx > 0) return 1;
  if (dx < 0) return -1;
  const dy = d[3] - d[1];
  return dy > 0 ? 1 : dy < 0 ? -1 : 0;
};
/** Negative when direction a comes first in the half turn (clockwise from north). */
export const compareDirections = (a: Dir, b: Dir): number => sgn(a) * sgn(b) * signOfDifference(a[2], a[0], b[3], b[1], a[3], a[1], b[2], b[0]);
/** Negative when a is nearer north-south than b (smaller acute angle with the north-south axis). */
export const compareNorthSouth = (a: Dir, b: Dir): number => signOfAbsDifference(a[2], a[0], b[3], b[1], b[2], b[0], a[3], a[1]);
/** Degrees clockwise from north in [0, 180), for reporting and drawing only. */
export function directionDeg(d: Dir): number {
  const s = sgn(d);
  let a = (atan2(s * (d[2] - d[0]), s * (d[3] - d[1])) * 180) / Math.PI;
  if (a < 0) a += 180;
  if (a >= 180) a -= 180;
  return a;
}
/** The end of a range nearer north-south; a range is as near north-south as its nearer end. */
export const nearestNorthSouth = (r: Range): Dir => (compareNorthSouth(r.s, r.e) <= 0 ? r.s : r.e);

/**
 * The generator's order for candidates: shorter border (exact), then nearer north-south, then the earlier start
 * direction in the half turn, then fewer seats on the first side.
 */
export function compareRanges(p: Range, q: Range): number {
  if (p.lengthUm !== q.lengthUm) return p.lengthUm < q.lengthUm ? -1 : 1;
  return compareNorthSouth(nearestNorthSouth(p), nearestNorthSouth(q)) || compareDirections(p.s, q.s) || p.lowSeats - q.lowSeats;
}

/** The direction at `deg` degrees clockwise from north, as (0, 0) to (sin, cos). */
export function directionAt(deg: number): Dir {
  if (deg >= 180) return [0, 0, 0, -1];
  const t = (deg * Math.PI) / 180;
  return [0, 0, sin(t), cos(t)];
}

/** The geometry a Chain needs: the piece's points, with the sweep's start and end directions. */
export function geoFor(piece: Piece, start: Dir, end: Dir, endIsPi: boolean): Geo {
  return {
    px: piece.px, py: piece.py, ids: piece.ids, pops: piece.pops,
    s1x: start[0], s1y: start[1], sx: start[2], sy: start[3], e1x: end[0], e1y: end[1], ex: end[2], ey: end[3], endIsPi,
  };
}

/** Sweep directions [aDeg, bDeg) for one first-side seat count, keeping the best `keep` resolved ranges. */
export function sweepChunk(piece: Piece, seats: number, lowSeats: number, aDeg: number, bDeg: number, keep: number): ChunkResult {
  const t0 = performance.now();
  const endIsPi = bDeg >= 180;
  const start = directionAt(aDeg), end = directionAt(bDeg);
  const g = geoFor(piece, start, end, endIsPi);
  const chain = new Chain(piece, g, seats, lowSeats);
  chain.start(-4, -2);
  const dir = (i: number, j: number): Dir => [X(g, i), Y(g, i), X(g, j), Y(g, j)];
  const top: Range[] = [];
  const unresolved: number[] = [];
  const unresolvedRanges: Range[] = [];
  let first: Range | undefined, last: Range | undefined;
  let resultRanges = 0, splitChanges = 0;
  let cur = { s: start, sDeg: aDeg, atStart: true };
  const snap = () => ({ lengthUm: chain.lengthUm, lowPop: chain.lowPop, h1: chain.h1, h2: chain.h2, unresolved: chain.unresolved });
  let res = snap();
  const close = (e: Dir, eDeg: number, atEnd: boolean) => {
    resultRanges++;
    const r: Range = { s: cur.s, e, sDeg: cur.sDeg, eDeg, ...res, lowSeats, edge: (cur.atStart ? 1 : 0) | (atEnd ? 2 : 0) };
    if (cur.atStart) first = r;
    if (atEnd) last = r;
    if (r.unresolved) { unresolved.push(r.lengthUm); unresolvedRanges.push(r); return; }
    if (top.length < keep || compareRanges(r, top[top.length - 1]!) < 0) {
      let i = top.length;
      while (i > 0 && compareRanges(r, top[i - 1]!) < 0) i--;
      top.splice(i, 0, r);
      if (top.length > keep) top.pop();
    }
  };
  for (;;) {
    const st = chain.step();
    if (!st) break;
    if (st.changedSets) splitChanges++;
    if (!st.changedResult) continue;
    const at = dir(st.ci, st.cj), atDeg = directionDeg(at);
    close(at, atDeg, false);
    cur = { s: at, sDeg: atDeg, atStart: false };
    res = snap();
  }
  close(end, bDeg, true);
  // Only unresolved ranges shorter than this chunk's best could be shorter than the cut's winner.
  const best = top[0]?.lengthUm ?? Infinity;
  const unresolvedBelow = [...new Set(unresolved.filter((u) => u < best))].sort((x, y) => x - y);
  return {
    lowSeats, aDeg, bDeg, top, first: first!, last: last!, unresolvedBelow, splitChanges, resultRanges,
    unresolvedRanges: unresolvedRanges.filter((u) => u.lengthUm < best).sort(compareRanges),
    stats: { ...chain.stats, ms: performance.now() - t0 },
  };
}

const sameResult = (a: Range, b: Range) => a.lengthUm === b.lengthUm && a.h1 === b.h1 && a.h2 === b.h2 && a.unresolved === b.unresolved;

/**
 * Every candidate the chunks found, with ranges that continue across chunk boundaries joined back into one range,
 * so the way the half turn was cut into chunks can never change a range's extent or a tie-break. `chunks` must
 * cover [0, 180) for each first-side seat count, in any order.
 */
export function mergeChunks(chunks: readonly ChunkResult[]): { ranges: Range[]; count: number } {
  const out = new Set<Range>();
  let joins = 0;
  const byOrientation = new Map<number, ChunkResult[]>();
  for (const c of chunks) byOrientation.set(c.lowSeats, [...(byOrientation.get(c.lowSeats) ?? []), c]);
  for (const list of byOrientation.values()) {
    list.sort((a, b) => a.aDeg - b.aDeg);
    // A range that reaches the end of its chunk continues into the next chunk's first range when the result is the
    // same (same length, same sides, same resolution); the members of each run are replaced by one joined range.
    const joined = new Map<Range, Range>();
    const run: { open: Range | null; members: Range[] } = { open: null, members: [] };
    const flush = () => { const o = run.open; if (o) for (const m of run.members) joined.set(m, o); run.open = null; run.members = []; };
    for (const c of list) {
      const f = c.first, o = run.open;
      if (o && sameResult(o, f)) { run.open = { ...o, e: f.e, eDeg: f.eDeg }; run.members.push(f); joins++; }
      else { flush(); run.open = f; run.members = [f]; }
      if (f !== c.last) { flush(); run.open = c.last; run.members = [c.last]; }
    }
    flush();
    for (const c of list) {
      for (const r of [c.first, c.last, ...c.top]) {
        const j = joined.get(r) ?? r;
        if (!j.unresolved) out.add(j);
      }
    }
  }
  // Joined ranges may have been reached through several members; keep one copy each.
  const uniq = new Map<string, Range>();
  for (const r of out) uniq.set(`${r.lowSeats}:${r.s.join(',')}:${r.e.join(',')}`, r);
  // Distinct results over the half turn: every chunk's ranges, less the pieces joined back together.
  return { ranges: [...uniq.values()].sort(compareRanges), count: chunks.reduce((s, c) => s + c.resultRanges, 0) - joins };
}
