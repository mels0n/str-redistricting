import { formatKm } from '../../shared/lib/format';
import type { Cut } from './model';

/**
 * Which piece of the state each district belongs to after the first `k`
 * cuts. Pieces are named by their first district (0-based), so after all
 * cuts every district is its own piece.
 *
 * Cuts are in the pre-order of the recursion, so when a cut is applied its
 * range [firstDistrict, firstDistrict + seats) is exactly one existing piece:
 * the lower-numbered part keeps the piece's name and the upper part starts
 * after it (see lowerSeats).
 */
export function piecesAfter(cuts: readonly Cut[], k: number, seats: number): number[] {
  const piece = new Array<number>(seats).fill(0);
  const ordered = [...cuts].sort((a, b) => a.order - b.order);
  const n = Math.max(0, Math.min(k, ordered.length));
  for (let i = 0; i < n; i++) {
    const c = ordered[i]!;
    const upper = c.firstDistrict + lowerSeats(ordered, c);
    for (let d = upper; d < c.firstDistrict + c.seats && d < seats; d++) piece[d] = upper;
  }
  return piece;
}

/**
 * Seats in the lower-numbered part of a cut's range. The side holding the
 * piece's lowest GEOID is numbered first, and that can be either side of the
 * line, so the size is read from the cuts: in pre-order the next cut splits
 * the lower part when it starts at the same district and holds fewer seats;
 * otherwise the lower part is a single district.
 */
function lowerSeats(cuts: readonly Cut[], cut: Cut): number {
  if (cut.lowSeats === cut.highSeats) return cut.lowSeats;
  const next = cuts.find((c) => c.order === cut.order + 1);
  return next && next.firstDistrict === cut.firstDistrict && next.seats < cut.seats ? next.seats : 1;
}

/** Sizes of the pieces, keyed by piece name. */
export function pieceSizes(piece: readonly number[]): Map<number, number> {
  const sizes = new Map<number, number>();
  for (const p of piece) sizes.set(p, (sizes.get(p) ?? 0) + 1);
  return sizes;
}

/** Districts (1-based) on each side of a cut: `low` holds lowSeats of them, `high` the rest. `cuts` is the state's whole list. */
export function cutSides(cut: Cut, cuts: readonly Cut[]): { low: [number, number]; high: [number, number] } {
  const f = cut.firstDistrict + 1;
  const n = lowerSeats(cuts, cut);
  const lower: [number, number] = [f, f + n - 1];
  const upper: [number, number] = [f + n, f + cut.seats - 1];
  return n === cut.lowSeats ? { low: lower, high: upper } : { low: upper, high: lower };
}

/**
 * The scrubber position. Position 0 is the whole state before any cut;
 * position k shows cuts 1..k. A state with N seats has N - 1 cuts.
 */
export interface CutStep {
  readonly k: number;
  readonly total: number;
}

export function cutStep(k: number, total: number): CutStep {
  const t = Math.max(0, Math.floor(total));
  const v = Number.isFinite(k) ? Math.floor(k) : 0;
  return { k: Math.max(0, Math.min(t, v)), total: t };
}

export function stepBy(s: CutStep, delta: number): CutStep {
  return cutStep(s.k + delta, s.total);
}

export function isLastStep(s: CutStep): boolean {
  return s.k >= s.total;
}

/** One cut as a row of the cut timetable: every figure already formatted for display. */
export interface CutRow {
  /** The cut's number, 1-based, as drawn on the map. */
  order: number;
  /** Seats in the piece this cut splits. */
  seats: number;
  /** How the seats divide: "4 + 3". */
  split: string;
  /** Guide-line direction: "154.1°". */
  direction: string;
  /** Length of the border the cut made: "339.3 km". */
  border: string;
}

/** The timetable of all cuts, in the order they are made. */
export function cutRows(cuts: readonly Cut[]): CutRow[] {
  return [...cuts]
    .sort((a, b) => a.order - b.order)
    .map((c) => ({
      order: c.order,
      seats: c.seats,
      split: `${c.lowSeats} + ${c.highSeats}`,
      direction: `${c.angleDeg.toFixed(2)}°`,
      border: formatKm(c.lengthM),
    }));
}

/** Whether a view reads the plan before balancing: that plan itself, or either replay (they start from it). Its shapes are fetched only then. */
export function planNeedsBefore(view: { plan: 'finished' | 'before'; cut: number | null; move: number | null }): boolean {
  return view.plan === 'before' || view.cut !== null || view.move !== null;
}
