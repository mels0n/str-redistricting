import { exactFallbacks, signOfDifference } from '../../shared/exact/index.js';
import { atan2, cos, sin } from '../../shared/detmath/index.js';
import { Chain } from './chain.js';
import type { Piece } from './scan.js';
import { X, Y, type Geo } from './tracker.js';

/**
 * (Docs: "Every direction is covered" and "Why the result is exact and reproducible".)
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
  /**
   * The sweep was cut short at bDeg to hand the rest to another thread (SplitHook), and some event lies exactly at
   * that direction. The parts then cannot be joined into the sweep of the whole chunk; it is swept again whole.
   */
  readonly eventAtEnd?: true;
  /**
   * A range or tie stretch of this sweep starts or ends at a direction that events of more than one pair of points
   * share (Chain.step). The pair recorded for it then depends on where the chain started, so this result is the one a
   * sweep from the usual start gives only when it was swept from that start (sweepSpans and joinParts check).
   */
  readonly ambiguous?: true;
}

/**
 * Lets a running chunk sweep hand the rest of its directions to another thread. Every few steps the sweep offers the
 * direction of its last event and its current end; `propose` answers a direction strictly between them, or null.
 * When the proposal lies exactly after the last event and before the end, the sweep calls `split` with it and the
 * old end; when that returns true, [proposed, old end) is another thread's and the sweep ends at the proposed direction.
 */
export interface SplitHook {
  propose(lastDeg: number, endDeg: number): number | null;
  split(atDeg: number, endDeg: number): boolean;
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

/** The geometry a Chain needs: the piece's points, with the sweep's start and end directions (and Geo.endEvents). */
export function geoFor(piece: Piece, start: Dir, end: Dir, endIsPi: boolean, endEvents = false): Geo {
  return {
    px: piece.px, py: piece.py, ids: piece.ids, pops: piece.pops,
    s1x: start[0], s1y: start[1], sx: start[2], sy: start[3], e1x: end[0], e1y: end[1], ex: end[2], ey: end[3], endIsPi, endEvents,
  };
}

/**
 * Sweep directions [aDeg, bDeg) for one first-side seat count, keeping the best `keep` resolved ranges. `cutEnd` when
 * bDeg is not the chunk's end but a split inside it (a part another thread swept, SplitHook): an event exactly at
 * bDeg is then reported as eventAtEnd, as the sweep that was cut short there reports it.
 */
export function sweepChunk(piece: Piece, seats: number, lowSeats: number, aDeg: number, bDeg: number, keep: number, beat?: () => void, split?: SplitHook, cutEnd = false): ChunkResult {
  return sweepSpan(piece, seats, lowSeats, directionAt(aDeg), directionAt(bDeg), aDeg, bDeg, bDeg >= 180, keep, true, beat, split, cutEnd && bDeg < 180);
}

/**
 * Sweep directions [start, end) (degrees aDeg, bDeg for reporting) for one first-side seat count. With `findTies`,
 * the stretches where some pass sits on an exact tie of its stopping rule are listed in `ties` (Tracker.atTie):
 * only there can the same line slid from the other end give different sides. `beat`, when given, is called every
 * 16384 steps to show the sweep is still running (the pool's stall check); nothing in the sweep reads it back.
 */
export function sweepSpan(piece: Piece, seats: number, lowSeats: number, start: Dir, end: Dir, aDeg: number, bDeg: number, endIsPi: boolean, keep: number, findTies: boolean, beat?: () => void, split?: SplitHook, cutEnd = false): ChunkResult {
  const t0 = performance.now(), f0 = exactFallbacks();
  const g = geoFor(piece, start, end, endIsPi, cutEnd);
  const chain = new Chain(piece, g, seats, lowSeats);
  chain.start(-4, -2);
  const steps = { n: 0 };
  const res = recordSpan(chain, g, lowSeats, { s: start, e: end, sDeg: aDeg, eDeg: bDeg, endIsPi }, keep, findTies, false, steps, beat, split, cutEnd);
  return { ...res, stats: { ...chain.stats, exactFallbacks: exactFallbacks() - f0, ms: performance.now() - t0 } };
}

/** One stretch of directions [s, e) to sweep (degrees sDeg, eDeg for reporting); `endIsPi` when e is the end of the half turn. */
export interface SpanBounds { readonly s: Dir; readonly e: Dir; readonly sDeg: number; readonly eDeg: number; readonly endIsPi: boolean }

/**
 * Work (tracker events) a window may spend sweeping one gap before it gives up on it and starts afresh at the next
 * stretch, per block of the piece per pass of the chain: about what a fresh start costs. Speed only: a stretch gives
 * the same result either way.
 */
export const GAP_BUDGET = 0.006;

/**
 * Sweep several stretches [s, e) of one first-side seat count in order, carrying one chain through the directions
 * between them (swept, nothing recorded), so a stretch after the first costs its gap instead of a fresh start. A gap
 * that runs past GAP_BUDGET is left and the next stretch starts afresh, so a window never costs much more than
 * sweeping its stretches one by one. Each stretch's result is the one sweepSpan gives it alone, since the sides at
 * every direction depend on that direction only, never on where the sweep began; only the work counters differ (each
 * result carries the work done since the one before it, so their sum is the window's). The stretches must be in turn
 * order, each starting at or after the end of the one before; only the last may end at the end of the half turn. A
 * stretch that records an ambiguous direction (ChunkResult.ambiguous) is swept again alone, as sweepSpan sweeps it.
 */
export function sweepSpans(piece: Piece, seats: number, lowSeats: number, spans: readonly SpanBounds[], keep: number, beat?: () => void, budget = GAP_BUDGET): ChunkResult[] {
  const last = spans[spans.length - 1]!;
  for (let k = 0; k < spans.length; k++) {
    const sp = spans[k]!;
    if ((sp.endIsPi && k < spans.length - 1) || (k > 0 && compareDirections(spans[k - 1]!.e, sp.s) > 0)) {
      throw new Error('tie stretches must be in turn order and only the last may end at the end of the half turn');
    }
  }
  let t0 = performance.now(), f0 = exactFallbacks();
  // Every chain's end is the window's end, so a stretch's last range ends where sweepSpan's would.
  const fresh = (from: Dir) => {
    const geo = geoFor(piece, from, last.e, last.endIsPi);
    const c = new Chain(piece, geo, seats, lowSeats);
    c.start(-4, -2);
    return { g: geo, chain: c };
  };
  let { g, chain } = fresh(spans[0]!.s);
  // Counters of the chains already left behind, so each result's counters are the work since the result before it.
  const done: Record<string, number> = {};
  const counted = (): Record<string, number> => {
    const now: Record<string, number> = { ...done };
    for (const [key, v] of Object.entries(chain.stats)) now[key] = (now[key] ?? 0) + v;
    return now;
  };
  const steps = { n: 0 };
  const out: ChunkResult[] = [];
  let before: Record<string, number> = {};
  for (let k = 0; k < spans.length; k++) {
    const sp = spans[k]!;
    if (k > 0) {
      // The gap: every event up to and including this stretch's start, so the chain stands just after it, as a fresh one would.
      const limit = chain.stats.trackerEvents + budget * piece.m * chain.passes.length;
      let nx = chain.peek();
      for (; nx && compareDirections(dirOf(g, nx.ci, nx.cj), sp.s) <= 0 && chain.stats.trackerEvents <= limit; nx = chain.peek()) {
        if (beat !== undefined && (++steps.n & 0x3fff) === 0) beat();
        chain.step();
      }
      if (nx && compareDirections(dirOf(g, nx.ci, nx.cj), sp.s) <= 0) {
        for (const [key, v] of Object.entries(chain.stats)) done[key] = (done[key] ?? 0) + v;
        // Let the old chain's trackers go before the new one is built, so a thread never holds two at once here.
        chain.release();
        ({ g, chain } = fresh(sp.s));
      }
    }
    let res = recordSpan(chain, g, lowSeats, sp, keep, false, k < spans.length - 1, steps, beat);
    // A chain that did not start at this stretch with its end may name an ambiguous direction by another pair.
    if (res.ambiguous && spans.length > 1) {
      const alone = sweepSpan(piece, seats, lowSeats, sp.s, sp.e, sp.sDeg, sp.eDeg, sp.endIsPi, keep, false);
      for (const [key, v] of Object.entries(alone.stats)) if (key !== 'ms' && key !== 'exactFallbacks') done[key] = (done[key] ?? 0) + v;
      const { stats: _s, ...rest } = alone;
      res = rest;
    }
    const now = counted();
    const stats: Record<string, number> = {};
    for (const key of Object.keys(now)) stats[key] = now[key]! - (before[key] ?? 0);
    before = now;
    out.push({ ...res, stats: { ...stats, exactFallbacks: exactFallbacks() - f0, ms: performance.now() - t0 } });
    t0 = performance.now(); f0 = exactFallbacks();
  }
  return out;
}

const dirOf = (g: Geo, i: number, j: number): Dir => [X(g, i), Y(g, i), X(g, j), Y(g, j)];

/** Steps between two offers to split (SplitHook). */
const SPLIT_EVERY = 32;

/**
 * Record one stretch on a chain that stands just after its start: every range up to its end. With `stopAtEnd` the
 * chain stops before the first event at or after the end (more stretches follow on it); otherwise it runs out, as the
 * chain's own end direction is the stretch's end. With `split`, the end can move earlier while the sweep runs.
 * `cutEnd`: the chain also holds the events exactly at its end (Geo.endEvents); the first of them ends the sweep
 * as eventAtEnd, before anything is recorded for it.
 */
function recordSpan(chain: Chain, g: Geo, lowSeats: number, span: SpanBounds, keep: number, findTies: boolean, stopAtEnd: boolean, steps: { n: number }, beat?: () => void, split?: SplitHook, cutEnd = false): Omit<ChunkResult, 'stats'> {
  const { s: start, sDeg: aDeg } = span;
  let { e: end, eDeg: bDeg, endIsPi } = span;
  let wasSplit = false, eventAtEnd = false, ambiguous = false;
  // The last event swept, as its pair of points (lastI, lastJ); its direction is only worked out when a split is offered.
  let lastI = -4, lastJ = -2;
  const dir = (i: number, j: number): Dir => dirOf(g, i, j);
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
    ++steps.n;
    if (beat !== undefined && (steps.n & 0x3fff) === 0) beat();
    if (split !== undefined && steps.n % SPLIT_EVERY === 1) {
      const lastDir = dir(lastI, lastJ), lastDeg = lastI === -4 ? aDeg : directionDeg(lastDir);
      const at = split.propose(lastDeg, bDeg);
      if (at !== null && at > lastDeg && at < bDeg) {
        const d = directionAt(at);
        // Exactly after the last event swept and before the end (the end of the half turn is after everything).
        if (compareDirections(lastDir, d) < 0 && (endIsPi || compareDirections(d, end) < 0) && split.split(at, bDeg)) {
          end = d; bDeg = at; endIsPi = false; stopAtEnd = true; wasSplit = true;
        }
      }
    }
    if (stopAtEnd) {
      const nx = chain.peek();
      if (!nx) break;
      const c = compareDirections(dir(nx.ci, nx.cj), end);
      if (c >= 0) { if (c === 0 && wasSplit) eventAtEnd = true; break; }
    }
    const st = chain.step();
    if (!st) break;
    // Only events exactly at the end are left once one lies there (the chain schedules none past it).
    if (cutEnd && !stopAtEnd && compareDirections(dir(st.ci, st.cj), end) === 0) { eventAtEnd = true; break; }
    lastI = st.ci; lastJ = st.cj;
    if (st.changedSets) splitChanges++;
    if (findTies && chain.atTie !== (tieFrom !== null)) {
      if (st.ambiguous) ambiguous = true;
      const at = dir(st.ci, st.cj), atDeg = directionDeg(at);
      if (tieFrom) { ties.push({ s: tieFrom.s, e: at, sDeg: tieFrom.sDeg, eDeg: atDeg, endIsPi: false }); tieFrom = null; }
      else tieFrom = { s: at, sDeg: atDeg };
    }
    if (!st.changedResult) continue;
    if (st.ambiguous) ambiguous = true;
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
    ...(eventAtEnd ? { eventAtEnd: true as const } : {}),
    ...(ambiguous ? { ambiguous: true as const } : {}),
  };
}

const sameDir = (a: Dir, b: Dir) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];

/**
 * The sweep of one chunk put back together from the sweeps of its parts (a chunk split while it ran, SplitHook):
 * exactly what one sweep of the whole chunk gives, counters aside (they are summed). `parts` are in turn order and
 * meet end to start. Returns null when they cannot be joined: a part ended exactly on an event (eventAtEnd), the
 * sides changed where two parts meet, which only an event there can do, or a part after the first (swept from a
 * split, not from the chunk's start) records an ambiguous direction; the chunk is then swept again whole.
 *
 * Without an event where two parts meet, the sides are the same just before and just after that direction, so the
 * range running into it continues in the next part and the two pieces are joined into one, as are tie stretches
 * running across it. A chunk keeps every resolved range no longer than its keep-th shortest (sweepSpan's top); each
 * part keeps at least the ranges of the chunk's top that lie in it, so the chunk's top is recomputed from the
 * parts' tops, and likewise its unresolved ranges shorter than its best. The joined sweep is ambiguous exactly when
 * the first part is (the others never are), and never ends on an event (only a cut-short part can).
 */
export function joinParts(parts: readonly ChunkResult[], keep: number): ChunkResult | null {
  if (parts.length === 1) return parts[0]!;
  for (let k = 0; k < parts.length; k++) {
    const p = parts[k]!;
    if ((p.eventAtEnd && k < parts.length - 1) || (p.ambiguous && k > 0)) return null;
    if (k > 0 && (p.aDeg !== parts[k - 1]!.bDeg || p.lowSeats !== parts[0]!.lowSeats || !sameResult(parts[k - 1]!.last, p.first))) return null;
  }
  const n = parts.length, a = parts[0]!, z = parts[n - 1]!;
  // Each boundary joins the range running into it with the one running out of it; a part with a single range is
  // joined on both sides. `joined` maps every piece to its whole range.
  const joined = new Map<Range, Range>();
  let open: Range = a.first, members: Range[] = [a.first];
  const flush = (atEnd: boolean) => {
    const edge = (members[0] === a.first ? 1 : 0) | (atEnd ? 2 : 0);
    const whole: Range = { ...open, edge };
    for (const m of members) joined.set(m, whole);
  };
  for (let k = 0; k < n; k++) {
    const p = parts[k]!;
    if (k > 0) { open = { ...open, e: p.first.e, eDeg: p.first.eDeg }; members.push(p.first); }
    if (p.first !== p.last) {
      flush(false);
      open = p.last; members = [p.last];
    }
  }
  flush(true);
  const whole = (r: Range): Range => {
    const j = joined.get(r);
    if (j) return j;
    // A range inside one part keeps its own extent; only its edge flags were the part's.
    if (r.edge === 0) return r;
    const w = { ...r, edge: 0 };
    joined.set(r, w);
    return w;
  };
  const resolved = new Set<Range>(), unresolvedSet = new Set<Range>();
  for (const p of parts) {
    for (const r of [p.first, ...p.top, p.last]) { const w = whole(r); if (!w.unresolved) resolved.add(w); }
    for (const r of p.unresolvedRanges) unresolvedSet.add(whole(r));
  }
  const sorted = [...resolved].sort(compareRanges);
  // sweepSpan's top: every resolved range no longer than the keep-th shortest.
  const cap = sorted.length >= keep ? sorted[keep - 1]!.lengthUm : Infinity;
  const top = sorted.filter((r) => r.lengthUm <= cap);
  const best = top[0]?.lengthUm ?? Infinity;
  const below = new Set<number>();
  for (const p of parts) for (const u of p.unresolvedBelow) if (u < best) below.add(u);
  const ties: TieSpan[] = [];
  for (const p of parts) {
    for (const t of p.ties) {
      const prev = ties[ties.length - 1];
      if (prev && prev.eDeg === t.sDeg && sameDir(prev.e, t.s) && t.sDeg === p.aDeg) ties[ties.length - 1] = { ...prev, e: t.e, eDeg: t.eDeg, endIsPi: t.endIsPi };
      else ties.push(t);
    }
  }
  const stats: Record<string, number> = {};
  for (const p of parts) for (const [k, v] of Object.entries(p.stats)) stats[k] = (stats[k] ?? 0) + v;
  return {
    lowSeats: a.lowSeats, aDeg: a.aDeg, bDeg: z.bDeg, top, first: whole(a.first), last: whole(z.last),
    unresolvedBelow: [...below].sort((x, y) => x - y),
    splitChanges: parts.reduce((s, p) => s + p.splitChanges, 0),
    resultRanges: parts.reduce((s, p) => s + p.resultRanges, 0) - (n - 1),
    ties,
    unresolvedRanges: [...unresolvedSet].filter((u) => u.lengthUm < best).sort(compareRanges),
    stats,
    ...(a.ambiguous ? { ambiguous: true as const } : {}),
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
