import { formatInt, formatPeople } from '../../shared';

const MINUS = '−';

/** An even split: every district holds `low` or `high` people. Both are whole; they are the same when the seats divide the population exactly. */
export interface EvenSplit {
  low: number;
  high: number;
  exact: boolean;
}

export function evenSplit(total: number, seats: number): EvenSplit {
  const low = Math.floor(total / seats);
  const exact = total % seats === 0;
  return { low, high: exact ? low : low + 1, exact };
}

/** "769,364 or 769,365", or "769,364" when the split is exact. */
export function evenSizes(total: number, seats: number): string {
  const s = evenSplit(total, seats);
  return s.exact ? formatInt(s.low) : `${formatInt(s.low)} or ${formatInt(s.high)}`;
}

/** "An even split is 769,364 or 769,365 people" / "An even split is exactly 769,364 people". */
export function evenSplitSentence(total: number, seats: number): string {
  const s = evenSplit(total, seats);
  return s.exact ? `An even split is exactly ${formatInt(s.low)} people` : `An even split is ${formatInt(s.low)} or ${formatInt(s.high)} people`;
}

/**
 * A percentage of whole people, to two significant figures; "<0.001%" when
 * smaller than that, so it is never rounded to nothing or given false precision.
 */
export function formatEvenPct(pct: number): string {
  if (pct === 0) return '0%';
  const abs = Math.abs(pct);
  const sign = pct < 0 ? MINUS : '+';
  if (abs < 0.001) return '<0.001%';
  return `${sign}${Number(abs.toPrecision(2))}%`;
}

export interface FromEven {
  /** Whole people from an even split: 0 inside it, otherwise the distance to its nearer end. */
  delta: number;
  /** `delta` with a sign: "+2", "−1", "0". */
  label: string;
  /** `delta` as a percent of the lower even-split size, formatted. */
  pct: string;
}

/** How far a district's population is from an even split, in whole people. */
export function fromEven(pop: number, total: number, seats: number): FromEven {
  const { low, high } = evenSplit(total, seats);
  const delta = pop > high ? pop - high : pop < low ? pop - low : 0;
  const label = delta === 0 ? '0' : delta < 0 ? `${MINUS}${formatPeople(-delta)}` : `+${formatPeople(delta)}`;
  return { delta, label, pct: formatEvenPct(low > 0 ? (delta / low) * 100 : 0) };
}

/** For a screen reader: "an even-split size", "2 people above an even split". */
export function describeFromEven(delta: number): string {
  if (delta === 0) return 'an even-split size';
  const n = Math.abs(delta);
  return `${formatInt(n)} ${n === 1 ? 'person' : 'people'} ${delta > 0 ? 'above' : 'below'} an even split`;
}
