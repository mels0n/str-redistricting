import { describe, expect, it } from 'vitest';
import { cutTagPlan, fitPadding, MAX_EARLIER_CUT_TAGS } from '../../src/client/shared/lib';

const none = { key: null, controls: null, keyBelow: false };

describe('fitPadding', () => {
  it('uses the base margin on a roomy frame with nothing over it', () => {
    expect(fitPadding({ frameW: 1200, frameH: 700, ...none })).toEqual({ top: 52, right: 32, bottom: 32, left: 32 });
  });

  it('clears the key at the top, whatever its height', () => {
    const key = { x: 200, y: 60, w: 300, h: 100 };
    expect(fitPadding({ frameW: 1200, frameH: 700, ...none, key }).top).toBe(118);
    // A short key never pulls the margin below the base.
    expect(fitPadding({ frameW: 1200, frameH: 700, ...none, key: { x: 200, y: 20, w: 100, h: 20 } }).top).toBe(52);
  });

  it('clears the zoom buttons on the side they sit on', () => {
    const right = fitPadding({ frameW: 1000, frameH: 600, ...none, controls: { x: 960, y: 60, w: 40, h: 80 } });
    expect(right.right).toBe(68);
    expect(right.left).toBe(32);
    const left = fitPadding({ frameW: 1000, frameH: 600, ...none, controls: { x: 60, y: 60, w: 40, h: 80 } });
    expect(left.left).toBe(88);
  });

  it('keeps room under the key on a short, wide frame', () => {
    const p = fitPadding({ frameW: 944, frameH: 440, ...none, key: { x: 160, y: 50, w: 300, h: 70 } });
    expect(p.top).toBeGreaterThanOrEqual(93);
    expect(p.top + p.bottom).toBeLessThanOrEqual(440 * 0.6 + 1);
  });

  it('with the key below the map (a phone) asks only for the small margin', () => {
    expect(fitPadding({ frameW: 390, frameH: 240, keyBelow: true, key: null, controls: null })).toEqual({ top: 14, right: 14, bottom: 14, left: 14 });
  });

  it('never asks for more than 60% of either side, so the state always has room', () => {
    const p = fitPadding({ frameW: 300, frameH: 120, keyBelow: false, key: { x: 100, y: 40, w: 200, h: 90 }, controls: { x: 270, y: 30, w: 40, h: 80 } });
    expect(p.top + p.bottom).toBeLessThanOrEqual(120 * 0.6 + 1);
    expect(p.left + p.right).toBeLessThanOrEqual(300 * 0.6 + 1);
  });
});

describe('cutTagPlan', () => {
  const orders = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

  it('labels every cut so far, the newest flagged, each named "Cut N"', () => {
    const plan = cutTagPlan(orders(4), { compact: false });
    expect(plan.map((t) => t.text)).toEqual(['Cut 1', 'Cut 2', 'Cut 3', 'Cut 4']);
    expect(plan.filter((t) => t.newest).map((t) => t.order)).toEqual([4]);
  });

  it('labels only the newest cut in a small frame', () => {
    expect(cutTagPlan(orders(8), { compact: true })).toEqual([{ order: 8, text: 'Cut 8', newest: true }]);
  });

  it('keeps only the latest earlier cuts in a long sequence', () => {
    const plan = cutTagPlan(orders(37), { compact: false });
    expect(plan).toHaveLength(MAX_EARLIER_CUT_TAGS + 1);
    expect(plan[0]!.order).toBe(37 - MAX_EARLIER_CUT_TAGS);
    expect(plan[plan.length - 1]).toEqual({ order: 37, text: 'Cut 37', newest: true });
  });

  it('has nothing to label before the first cut', () => {
    expect(cutTagPlan([], { compact: false })).toEqual([]);
  });
});
