import { describe, expect, it } from 'vitest';
import { boxesOverlap, boxInside, clusterPoints, firstClearSpot, offsetToClear, placeNumbers, type Box } from '../../src/client/shared/lib/labels';
import { pointAlongLines } from '../../src/client/shared/lib/geo';
import { cutRows, type Cut } from '../../src/client/entities/plan';

const frame = { w: 400, h: 300 };

describe('label boxes', () => {
  it('detects overlap and clearance', () => {
    const a: Box = { x: 100, y: 100, w: 26, h: 22 };
    expect(boxesOverlap(a, { x: 110, y: 105, w: 20, h: 20 })).toBe(true);
    expect(boxesOverlap(a, { x: 140, y: 100, w: 20, h: 20 })).toBe(false);
    // Boxes that just touch do not overlap, but a gap can keep them apart.
    expect(boxesOverlap(a, { x: 123, y: 100, w: 20, h: 22 })).toBe(false);
    expect(boxesOverlap(a, { x: 123, y: 100, w: 20, h: 22 }, 2)).toBe(true);
  });

  it('keeps boxes inside the frame', () => {
    expect(boxInside({ x: 200, y: 150, w: 20, h: 20 }, frame)).toBe(true);
    expect(boxInside({ x: 5, y: 150, w: 20, h: 20 }, frame)).toBe(false);
    expect(boxInside({ x: 200, y: 295, w: 20, h: 20 }, frame)).toBe(false);
  });
});

describe('cut number placement', () => {
  const size = { w: 20, h: 18 };
  const district: Box = { x: 200, y: 150, w: 26, h: 22 };

  it('picks the first spot along the line that is clear of a district number', () => {
    // The middle of the line sits on district 2; the next spot along is clear.
    const spots = [{ x: 200, y: 150 }, { x: 240, y: 150 }, { x: 160, y: 150 }];
    expect(firstClearSpot(spots, size, [district], frame)).toBe(1);
  });

  it('returns null when every spot is blocked, so the caller can relax the rule', () => {
    const spots = [{ x: 200, y: 150 }, { x: 205, y: 150 }];
    expect(firstClearSpot(spots, size, [district], frame)).toBeNull();
  });

  it('skips spots that fall outside the frame', () => {
    const spots = [{ x: 4, y: 150 }, { x: 60, y: 150 }];
    expect(firstClearSpot(spots, size, [], frame)).toBe(1);
  });

  it('keeps cut numbers from covering each other', () => {
    const other: Box = { x: 100, y: 100, w: 20, h: 18 };
    expect(firstClearSpot([{ x: 104, y: 100 }, { x: 150, y: 100 }], size, [other], frame)).toBe(1);
  });
});

describe('district number placement', () => {
  const size = { w: 26, h: 22 };

  it('stays put when its spot is free', () => {
    expect(offsetToClear({ x: 100, y: 100 }, size, [], frame)).toEqual({ dx: 0, dy: 0 });
  });

  it('moves out from under a cut number to a spot that clears it and stays in the frame', () => {
    const tag: Box = { x: 100, y: 100, w: 22, h: 20 };
    const o = offsetToClear({ x: 104, y: 100 }, size, [tag], frame);
    expect(o.dx !== 0 || o.dy !== 0).toBe(true);
    const moved: Box = { x: 104 + o.dx, y: 100 + o.dy, ...size };
    expect(boxesOverlap(moved, tag)).toBe(false);
    expect(boxInside(moved, frame)).toBe(true);
  });

  it('does not move when the frame is too crowded to help', () => {
    const wall: Box = { x: 200, y: 150, w: 2000, h: 2000 };
    expect(offsetToClear({ x: 200, y: 150 }, size, [wall], frame)).toEqual({ dx: 0, dy: 0 });
  });
});

describe('points along a cut line', () => {
  const line = [[[0, 0], [10, 0]]];
  it('walks a fraction of the line length', () => {
    expect(pointAlongLines(line, 0.5)).toEqual([5, 0]);
    expect(pointAlongLines(line, 0.2)).toEqual([2, 0]);
    expect(pointAlongLines(line, 1)).toEqual([10, 0]);
    expect(pointAlongLines(line, 7)).toEqual([10, 0]);
  });
  it('uses the longest line and gives null for none', () => {
    expect(pointAlongLines([[[0, 0], [1, 0]], [[0, 0], [0, 10]]], 0.3)).toEqual([0, 3]);
    expect(pointAlongLines([], 0.5)).toBeNull();
  });
});

describe('cut timetable rows', () => {
  const cut = (order: number, over: Partial<Cut> = {}): Cut => ({
    order,
    depth: 0,
    seats: 8,
    lowSeats: 4,
    highSeats: 4,
    firstDistrict: 0,
    angleDeg: 154.14,
    lengthM: 339_321,
    lines: [[[0, 0], [1, 1]]],
    ...over,
  });

  it('formats each cut for display, in order', () => {
    const rows = cutRows([cut(2, { seats: 4, lowSeats: 2, highSeats: 2, angleDeg: 90, lengthM: 19_369 }), cut(1)]);
    expect(rows).toEqual([
      { order: 1, seats: 8, split: '4 + 4', direction: '154.1°', border: '339.3 km' },
      { order: 2, seats: 4, split: '2 + 2', direction: '90.0°', border: '19.4 km' },
    ]);
  });

  it('has no rows for no cuts', () => {
    expect(cutRows([])).toEqual([]);
  });
});

describe('district numbers at phone size', () => {
  const phone = { w: 390, h: 300 };
  const size = { w: 32, h: 28 };
  const shownBoxes = (pts: { x: number; y: number }[], res: ReturnType<typeof placeNumbers>): Box[] =>
    pts.flatMap((p, i) => (res[i]!.shown ? [{ x: p.x + res[i]!.dx, y: p.y + res[i]!.dy, ...size }] : []));
  const noneOverlap = (boxes: Box[]): boolean => boxes.every((a, i) => boxes.every((b, j) => i === j || !boxesOverlap(a, b)));

  it('keeps every shown number clear of the others in a crowded city', () => {
    // 17 districts packed into a 50 px patch, as in a big city on a phone.
    const pts = Array.from({ length: 17 }, (_, i) => ({ x: 270 + (i % 4) * 11, y: 160 + Math.floor(i / 4) * 10 }));
    const order = pts.map((_, i) => i);
    const res = placeNumbers(pts, order, size, [], phone);
    expect(noneOverlap(shownBoxes(pts, res))).toBe(true);
    expect(res.every((r) => r.shown)).toBe(true);
  });

  it('leaves out what cannot fit instead of overlapping, and gives the chosen district first claim', () => {
    const pts = Array.from({ length: 60 }, (_, i) => ({ x: 200 + (i % 8) * 4, y: 150 + Math.floor(i / 8) * 4 }));
    const order = [59, ...pts.map((_, i) => i).filter((i) => i !== 59)];
    const res = placeNumbers(pts, order, size, [], phone);
    expect(noneOverlap(shownBoxes(pts, res))).toBe(true);
    expect(res[59]).toEqual({ dx: 0, dy: 0, shown: true });
    expect(res.some((r) => !r.shown)).toBe(true);
  });

  it('keeps numbers out from under fixed boxes such as the zoom buttons', () => {
    const control: Box = { x: 358, y: 246, w: 48, h: 92 };
    const pts = [{ x: 350, y: 240 }];
    const res = placeNumbers(pts, [0], size, [control], phone);
    expect(boxesOverlap({ x: 350 + res[0]!.dx, y: 240 + res[0]!.dy, ...size }, control)).toBe(false);
  });

  it('ignores points far outside the frame', () => {
    const res = placeNumbers([{ x: -300, y: 10 }], [0], size, [], phone);
    expect(res[0]).toEqual({ dx: 0, dy: 0, shown: true });
  });

  it('groups crowded points into clusters', () => {
    const groups = clusterPoints([{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 60, y: 0 }, { x: 400, y: 0 }], 40);
    expect(groups.map((g) => g.length).sort()).toEqual([1, 3]);
  });
});
