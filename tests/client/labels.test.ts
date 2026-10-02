import { describe, expect, it } from 'vitest';
import {
  boxesOverlap,
  boxInside,
  boxInsideShape,
  boxOutsideShapes,
  clusterPoints,
  firstClearSpot,
  makeShape,
  NumberPlacer,
  offsetToClear,
  pointInShape,
  segmentsCross,
  type Box,
  type NumberItem,
  type Pt,
  type Shape,
} from '../../src/client/shared/lib/labels';
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

describe('district numbers stay with their own district', () => {
  // A phone-size frame, 390 x 300, with a state drawn as one block split into districts.
  const phone = { w: 390, h: 300 };
  const rect = (x0: number, y0: number, x1: number, y1: number): Shape => makeShape([[[{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }]]]);
  const size = { w: 28, h: 28 };
  const centerOf = (s: Shape): Pt => ({ x: (s.bbox[0] + s.bbox[2]) / 2, y: (s.bbox[1] + s.bbox[3]) / 2 });
  const item = (shape: Shape, anchor: Pt = centerOf(shape)): NumberItem => ({ anchor, size, shape });
  const boxAt = (spot: { x: number; y: number }): Box => ({ x: spot.x, y: spot.y, ...size });

  it('keeps a number put when its district has room', () => {
    const d = rect(100, 100, 200, 200);
    const placer = new NumberPlacer([d], [], phone);
    expect(placer.placeNumber(item(d))).toEqual({ kind: 'inside', x: 150, y: 150 });
  });

  it('moves a number to another spot inside its own district, never into a neighbor', () => {
    const left = rect(100, 100, 160, 200);
    const right = rect(160, 100, 260, 200);
    // The left district's natural spot is on a cut tag; its number must stay inside the left district.
    const tag: Box = { x: 130, y: 150, w: 24, h: 20 };
    const placer = new NumberPlacer([left, right], [tag], phone);
    const spot = placer.placeNumber(item(left, { x: 130, y: 150 }))!;
    expect(spot.kind).toBe('inside');
    expect(boxInsideShape(boxAt(spot), left)).toBe(true);
    expect(boxesOverlap(boxAt(spot), tag)).toBe(false);
  });

  it('gives a district too small for its number a spot in empty ground just outside the state, with a short leader', () => {
    // A thin sliver at the state's edge: 6 px wide, so a 28 px number cannot sit in it.
    const sliver = rect(200, 100, 206, 140);
    const body = rect(100, 100, 200, 200);
    const placer = new NumberPlacer([sliver, body], [], phone);
    const anchor = centerOf(sliver);
    const spot = placer.placeNumber(item(sliver))!;
    expect(spot.kind).toBe('outside');
    expect(Math.hypot(spot.x - anchor.x, spot.y - anchor.y)).toBeLessThanOrEqual(48);
    expect(boxOutsideShapes(boxAt(spot), [sliver, body])).toBe(true);
  });

  it('never puts a number inside another district, even when that is the only room nearby', () => {
    // A small district in the middle of the state: no empty ground within reach, so no spot at all.
    const hole = rect(195, 145, 205, 155);
    const body = rect(100, 100, 300, 200);
    const placer = new NumberPlacer([hole, body], [], phone);
    expect(placer.placeNumber(item(hole))).toBeNull();
  });

  it('keeps every placed number off every other number and off earlier leaders', () => {
    // Six slivers along the state's east edge: each needs a spot outside, none may overlap or cross.
    const body = rect(100, 40, 300, 260);
    const slivers = Array.from({ length: 6 }, (_, i) => rect(300, 60 + i * 12, 304, 70 + i * 12));
    const shapes = [body, ...slivers];
    const placer = new NumberPlacer(shapes, [], phone);
    const spots = slivers.map((s) => placer.placeNumber(item(s))).filter((s) => s !== null);
    const boxes = spots.map(boxAt);
    expect(boxes.every((a, i) => boxes.every((b, j) => i === j || !boxesOverlap(a, b)))).toBe(true);
    // No spot lands inside the state.
    expect(boxes.every((b) => boxOutsideShapes(b, shapes))).toBe(true);
    // Leaders do not cross each other.
    const leaders = spots.map((s, i) => ({ a: centerOf(slivers[i]!), b: { x: s.x, y: s.y } }));
    for (let i = 0; i < leaders.length; i++) for (let j = i + 1; j < leaders.length; j++) expect(segmentsCross(leaders[i]!, leaders[j]!)).toBe(false);
  });

  it('keeps numbers out from under fixed boxes such as the zoom buttons', () => {
    const d = rect(300, 200, 390, 300);
    const control: Box = { x: 358, y: 246, w: 48, h: 92 };
    const spot = new NumberPlacer([d], [control], phone).placeNumber(item(d, { x: 350, y: 240 }));
    if (spot) expect(boxesOverlap(boxAt(spot), control)).toBe(false);
  });

  it('places a crowd marker inside one of the crowded districts when one has room, else outside the state', () => {
    const big = rect(100, 100, 200, 200);
    const tiny = rect(200, 100, 206, 106);
    const marker = { w: 44, h: 28 };
    const placer = new NumberPlacer([big, tiny], [], phone);
    const inBig = placer.placeMarker(marker, [item(tiny), item(big)], centerOf(tiny))!;
    expect(inBig.kind).toBe('inside');
    expect(boxInsideShape({ x: inBig.x, y: inBig.y, ...marker }, big)).toBe(true);
    const onlyTiny = new NumberPlacer([big, tiny], [], phone).placeMarker(marker, [item(tiny)], centerOf(tiny))!;
    expect(onlyTiny.kind).toBe('outside');
    expect(boxOutsideShapes({ x: onlyTiny.x, y: onlyTiny.y, ...marker }, [big, tiny])).toBe(true);
  });

  it('tests points and boxes against shapes with holes', () => {
    const donut = makeShape([[[{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }], [{ x: 40, y: 40 }, { x: 60, y: 40 }, { x: 60, y: 60 }, { x: 40, y: 60 }]]]);
    expect(pointInShape({ x: 50, y: 50 }, donut)).toBe(false);
    expect(pointInShape({ x: 20, y: 20 }, donut)).toBe(true);
    expect(boxInsideShape({ x: 20, y: 20, w: 20, h: 20 }, donut)).toBe(true);
    expect(boxInsideShape({ x: 40, y: 50, w: 20, h: 20 }, donut)).toBe(false);
  });

  it('groups crowded points into clusters', () => {
    const groups = clusterPoints([{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 60, y: 0 }, { x: 400, y: 0 }], 40);
    expect(groups.map((g) => g.length).sort()).toEqual([1, 3]);
  });
});
