/** Rough width of a tick label in pixels: the digits at the label's size, plus the padding the current label carries. */
const DIGIT_PX = 7;
const CURRENT_PAD_PX = 6;
const GAP_PX = 3;

/** True for ticks that always show their number: every tick on a short axis, every fifth and the last on a long one. */
export function isMajorTick(i: number, total: number): boolean {
  return total <= 16 || i % 5 === 0 || i === total;
}

/**
 * The fixed tick labels to hide at step `current` because they would run into the
 * current-step label, on an axis `trackPx` wide with ticks 0..total. The current
 * label is always shown.
 */
export function collidingTicks(total: number, current: number, trackPx: number): Set<number> {
  const hide = new Set<number>();
  if (total <= 0 || trackPx <= 0) return hide;
  const x = (i: number): number => (i / total) * trackPx;
  const width = (i: number): number => String(i).length * DIGIT_PX;
  const curW = width(current) + CURRENT_PAD_PX;
  for (let i = 0; i <= total; i++) {
    if (i === current || !isMajorTick(i, total)) continue;
    if (Math.abs(x(i) - x(current)) < (width(i) + curW) / 2 + GAP_PX) hide.add(i);
  }
  return hide;
}
