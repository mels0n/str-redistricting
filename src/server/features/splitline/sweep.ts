import { exactFallbacks, signOfDifference } from '../../shared/exact/index.js';
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
  /** Border length in whole micrometers (exact) and in meters (for reporting). */
  readonly lengthUm: number;
  readonly lowPop: number;
  readonly h1: number;
  readonly h2: number;
  readonly unresolved: boolean;
  readonly lowSeats: number;
  /** 1 when this range starts at its chunk's start, 2 when it ends at its chunk's end (3 for both). */
  readonly edge: number;
  /**
   * The range runs across north-south: it starts before 180 degrees (sDeg) and continues past 0 degrees, where the
   * same line has its sides the other way round, to eDeg - 180. Such a range contains north-south itself.
   */
  readonly wraps?: boolean;
  /**
   * Where to evaluate the range for its sides. For a range across north-south this is its part after 0 degrees, so
   * its first side is the one a line just past north-south has first (as for any range that starts at 0 degrees).
   */
  readonly at?: Dir;
  /**
   * The range is the line slid from the other end: swept on the piece turned half way round (every point negated),
   * which is the same line at the same direction with the stopping rule's exact ties decided the other way.
   */
  readonly reversed?: boolean;
}

/** A stretch of directions [s, e) where some pass of the sweep sat on an exact tie of its stopping rule. */
export interface TieSpan { readonly s: Dir; readonly e: Dir; readonly sDeg: number; readonly eDeg: number; readonly endIsPi: boolean }

export interface ChunkResult {
  readonly lowSeats: number;
  /** Stretches where the line slid from the other end may give different sides (sweepSpan with findTies). */
  readonly ties: readonly TieSpan[];
  readonly aDeg: number;
  readonly bDeg: number;
  /** The chunk's best resolved ranges in listing order (every range as long as the last kept one, so ties are never cut), plus its first and last range (which may continue in a neighbouring chunk). */
  readonly top: readonly Range[];
  readonly first: Range;
  readonly last: Range;
  /** Distinct lengths (whole micrometers) of the chunk's unresolved ranges shorter than its best resolved range, ascending. */
  readonly unresolvedBelow: readonly number[];
  /** The unresolved ranges behind unresolvedBelow, in generator order (a range cut by a chunk edge appears once per chunk). */
  readonly unresolvedRanges: readonly Range[];
  /** Directions where some pass's split changed (only changes to which blocks sit on each side are counted). */
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
/** Degrees clockwise from north in [0, 180), for reporting and drawing only. */
export function directionDeg(d: Dir): number {
  const s = sgn(d);
  let a = (atan2(s * (d[2] - d[0]), s * (d[3] - d[1])) * 180) / Math.PI;
  if (a < 0) a += 180;
  // Only north-south itself is 0. A direction just short of a half turn can round to 180; it stays at the end of the
  // half turn (the largest double below 180), never at its start, so ranges and their middles keep their order.
  if (a >= 180) a = s * (d[2] - d[0]) === 0 ? 0 : 180 - 180 * Number.EPSILON;
  return a;
}
const NORTH: Dir = [0, 0, 0, 1];
/** Where a range starts, for listing: a range that runs across north-south starts at north-south. */
const startOf = (r: Range): Dir => (r.wraps ? NORTH : r.s);

/**
 * The order ranges are listed and tried in: shorter border (exact), then the earlier start direction in the half
 * turn clockwise from north, then fewer seats on the first side. Only the length is a rule. Ranges of equal length
 * are all evaluated, and the cut among them is chosen by GEOID (cut.ts); this order only decides which of several
 * ranges giving that same cut has its middle drawn as the guide line.
 */
export function compareRanges(p: Range, q: Range): number {
  if (p.lengthUm !== q.lengthUm) return p.lengthUm < q.lengthUm ? -1 : 1;
  return compareDirections(startOf(p), startOf(q)) || p.lowSeats - q.lowSeats;
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
  return sweepSpan(piece, seats, lowSeats, directionAt(aDeg), directionAt(bDeg), aDeg, bDeg, bDeg >= 180, keep, true);
}

/**
 * Sweep directions [start, end) (degrees aDeg, bDeg for reporting) for one first-side seat count. With `findTies`,
 * the stretches where some pass sits on an exact tie of its stopping rule are listed in `ties` (Tracker.atTie):
 * only there can the same line slid from the other end give different sides.
 */
export function sweepSpan(piece: Piece, seats: number, lowSeats: number, start: Dir, end: Dir, aDeg: number, bDeg: number, endIsPi: boolean, keep: number, findTies: boolean): ChunkResult {
  const t0 = performance.now(), f0 = exactFallbacks();
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
  // Stretches where some pass sits on a stopping-rule tie, from the event where the tie starts to the event where it
  // ends: events are the same however the half turn is cut into chunks, so the stretches are too (a chunk edge only
  // splits one, and findCut joins the pieces back).
  const ties: TieSpan[] = [];
  let tieFrom: { s: Dir; sDeg: number } | null = findTies && chain.atTie ? { s: start, sDeg: aDeg } : null;
  const close = (e: Dir, eDeg: number, atEnd: boolean) => {
    resultRanges++;
    const r: Range = { s: cur.s, e, sDeg: cur.sDeg, eDeg, ...res, lowSeats, edge: (cur.atStart ? 1 : 0) | (atEnd ? 2 : 0) };
    if (cur.atStart) first = r;
    if (atEnd) last = r;
    if (r.unresolved) { unresolved.push(r.lengthUm); unresolvedRanges.push(r); return; }
    if (top.length < keep || r.lengthUm <= top[keep - 1]!.lengthUm) {
      let i = top.length;
      while (i > 0 && compareRanges(r, top[i - 1]!) < 0) i--;
      top.splice(i, 0, r);
      // Never drop a range as long as the last one kept: ranges of equal length are decided by their sides, not this order.
      while (top.length > keep && top[top.length - 1]!.lengthUm > top[keep - 1]!.lengthUm) top.pop();
    }
  };
  for (;;) {
    const st = chain.step();
    if (!st) break;
    if (st.changedSets) splitChanges++;
    if (findTies && chain.atTie !== (tieFrom !== null)) {
      const at = dir(st.ci, st.cj), atDeg = directionDeg(at);
      if (tieFrom) { ties.push({ s: tieFrom.s, e: at, sDeg: tieFrom.sDeg, eDeg: atDeg, endIsPi: false }); tieFrom = null; }
      else tieFrom = { s: at, sDeg: atDeg };
    }
    if (!st.changedResult) continue;
    const at = dir(st.ci, st.cj), atDeg = directionDeg(at);
    close(at, atDeg, false);
    cur = { s: at, sDeg: atDeg, atStart: false };
    res = snap();
  }
  close(end, bDeg, true);
  if (tieFrom) ties.push({ s: tieFrom.s, e: end, sDeg: tieFrom.sDeg, eDeg: bDeg, endIsPi });
  // Only unresolved ranges shorter than this chunk's best could be shorter than the cut's winner.
  const best = top[0]?.lengthUm ?? Infinity;
  const unresolvedBelow = [...new Set(unresolved.filter((u) => u < best))].sort((x, y) => x - y);
  return {
    lowSeats, aDeg, bDeg, top, first: first!, last: last!, unresolvedBelow, splitChanges, resultRanges, ties,
    unresolvedRanges: unresolvedRanges.filter((u) => u.lengthUm < best).sort(compareRanges),
    stats: { ...chain.stats, exactFallbacks: exactFallbacks() - f0, ms: performance.now() - t0 },
  };
}

const sameResult = (a: Range, b: Range) => a.lengthUm === b.lengthUm && a.h1 === b.h1 && a.h2 === b.h2 && a.unresolved === b.unresolved;

/**
 * Every candidate the chunks found, with ranges that continue across chunk boundaries joined back into one range,
 * so the way the half turn was cut into chunks can never change a range's extent or a tie-break. `chunks` must
 * cover [0, 180) for each first-side seat count, in any order.
 *
 * The half turn is a loop: the line at 180 degrees is the line at 0 degrees with its sides the other way round. So
 * the range that reaches 180 degrees for one first-side seat count continues into the range that starts at 0 degrees
 * for the other count (the same count when both sides have the same seats) when it gives the same two sides,
 * swapped: same length, and its first side is the other's second side. `whole` holds the fingerprints of every
 * block of the piece, which is how "the other's second side" is recognised; without it the ends are not joined.
 */
export function mergeChunks(chunks: readonly ChunkResult[], whole?: { readonly h1: number; readonly h2: number }): { ranges: Range[]; count: number } {
  const out = new Set<Range>();
  let joins = 0;
  const joined = new Map<Range, Range>();
  const ends = new Map<number, { first: Range; last: Range }>();
  const byOrientation = new Map<number, ChunkResult[]>();
  for (const c of chunks) byOrientation.set(c.lowSeats, [...(byOrientation.get(c.lowSeats) ?? []), c]);
  for (const [lowSeats, list] of byOrientation) {
    list.sort((a, b) => a.aDeg - b.aDeg);
    // A range that reaches the end of its chunk continues into the next chunk's first range when the result is the
    // same (same length, same sides, same resolution); the members of each run are replaced by one joined range.
    const run: { open: Range | null; members: Range[] } = { open: null, members: [] };
    const flush = () => { const o = run.open; if (o) for (const m of run.members) joined.set(m, o); run.open = null; run.members = []; };
    for (const c of list) {
      const f = c.first, o = run.open;
      if (o && sameResult(o, f)) { run.open = { ...o, e: f.e, eDeg: f.eDeg }; run.members.push(f); joins++; }
      else { flush(); run.open = f; run.members = [f]; }
      if (f !== c.last) { flush(); run.open = c.last; run.members = [c.last]; }
    }
    flush();
    ends.set(lowSeats, { first: joined.get(list[0]!.first)!, last: joined.get(list[list.length - 1]!.last)! });
  }
  if (whole) {
    // Join each orientation's last range to the mirror orientation's first range across 180 / 0 degrees.
    const seats = [...ends.keys()];
    const mirror = (o: number): number => (seats.length === 1 ? o : seats.find((x) => x !== o)!);
    const wrapped = new Map<Range, Range>();
    for (const o of seats) {
      const a = ends.get(o)!.last, b = ends.get(mirror(o))!.first;
      if (a === b || wrapped.has(a) || wrapped.has(b)) continue;
      const swapped = a.lengthUm === b.lengthUm && a.unresolved === b.unresolved && (a.h1 ^ b.h1) >>> 0 === whole.h1 >>> 0 && (a.h2 ^ b.h2) >>> 0 === whole.h2 >>> 0;
      if (!swapped) continue;
      // Sides, seat count and fingerprints from the part after 0 degrees; extent from a's start on past 180 to b's end.
      const w: Range = { ...b, s: a.s, sDeg: a.sDeg, e: b.e, eDeg: b.eDeg + 180, wraps: true, at: b.s };
      wrapped.set(a, w); wrapped.set(b, w);
      joins++;
    }
    for (const [m, j] of joined) { const w = wrapped.get(j); if (w) joined.set(m, w); }
  }
  for (const list of byOrientation.values()) {
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
