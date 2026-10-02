/** Rough width of a tick label in pixels: the digits at the label's size, plus the padding the current label carries. */
const DIGIT_PX = 7;
const CURRENT_PAD_PX = 6;
const GAP_PX = 3;

/** True for ticks that always show their number: every tick on a short axis, every fifth and the last on a long one. */
export function isMajorTick(i: number, total: number): boolean {
  return total <= 16 || i % 5 === 0 || i === total;
}

/** Round steps for a long axis, smallest first. */
const STEPS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];

/**
 * The numbered ticks of a long axis (the balancing moves run to several
 * hundred): 0, the last, and round numbers in between, at most about ten in
 * all. A round number that would sit too close to the last one is left out.
 */
export function sparseTicks(total: number, maxLabels = 10): number[] {
  if (total <= 0) return [0];
  const step = STEPS.find((s) => total / s <= maxLabels) ?? Math.ceil(total / maxLabels);
  const out: number[] = [];
  for (let i = 0; i < total; i += step) if (total - i >= step / 2 || i === 0) out.push(i);
  out.push(total);
  return out;
}

/**
 * The fixed tick labels to hide at step `current` because they would run into the
 * current-step label, on an axis `trackPx` wide with ticks 0..total. The current
 * label is always shown. `majors` lists the labelled ticks when the axis is sparse.
 */
export function collidingTicks(total: number, current: number, trackPx: number, majors?: readonly number[]): Set<number> {
  const hide = new Set<number>();
  if (total <= 0 || trackPx <= 0) return hide;
  const x = (i: number): number => (i / total) * trackPx;
  const width = (i: number): number => String(i).length * DIGIT_PX;
  const curW = width(current) + CURRENT_PAD_PX;
  const labelled = majors ?? Array.from({ length: total + 1 }, (_, i) => i).filter((i) => isMajorTick(i, total));
  for (const i of labelled) {
    if (i === current) continue;
    if (Math.abs(x(i) - x(current)) < (width(i) + curW) / 2 + GAP_PX) hide.add(i);
  }
  return hide;
}
