import { describe, expect, it } from 'vitest';
import { collidingTicks, isMajorTick } from '../../src/client/features/cut-scrubber/ticks';

describe('scrubber axis labels', () => {
  it('hides the fixed label that the current-step label would run into', () => {
    // Cut 21 of 37 on a 700 px axis sits almost on the fixed "20".
    expect([...collidingTicks(37, 21, 700)]).toEqual([20]);
    // Far from any fixed label, nothing is hidden.
    expect(collidingTicks(37, 23, 700).size).toBe(0);
  });

  it('never hides the current label, and only hides labels that are shown', () => {
    const hidden = collidingTicks(37, 20, 700);
    expect(hidden.has(20)).toBe(false);
    for (const i of collidingTicks(37, 22, 300)) expect(isMajorTick(i, 37)).toBe(true);
  });

  it('leaves no two visible labels overlapping at any step and any width', () => {
    for (const total of [3, 7, 16, 21, 37]) {
      for (const px of [220, 260, 300, 340, 500, 700, 1000]) {
        for (let k = 0; k <= total; k++) {
          const hidden = collidingTicks(total, k, px);
          const shown = Array.from({ length: total + 1 }, (_, i) => i).filter((i) => (i === k || isMajorTick(i, total)) && !hidden.has(i));
          const x = (i: number): number => (i / total) * px;
          const w = (i: number): number => String(i).length * 7 + (i === k ? 6 : 0);
          // Only the current label can collide with the others; fixed labels are spaced by design.
          for (const i of shown) if (i !== k) expect(Math.abs(x(i) - x(k))).toBeGreaterThanOrEqual((w(i) + w(k)) / 2);
        }
      }
    }
  });

  it('handles an empty axis', () => {
    expect(collidingTicks(0, 0, 300).size).toBe(0);
    expect(collidingTicks(7, 3, 0).size).toBe(0);
  });
});
