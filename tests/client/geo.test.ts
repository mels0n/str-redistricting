import { describe, expect, it } from 'vitest';
import type { MultiPolygon, Polygon, Position } from 'geojson';
import { bboxOf, labelPoint, landLabelPoint, lineLabelPoint, partialLines, pointInGeometry, pointInRing } from '../../src/client/shared/lib/geo';

const square: Position[] = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
const hole: Position[] = [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]];

describe('point in polygon', () => {
  it('tests a ring', () => {
    expect(pointInRing([5, 5], square)).toBe(true);
    expect(pointInRing([11, 5], square)).toBe(false);
    expect(pointInRing([-0.1, 5], square)).toBe(false);
  });

  it('respects holes and multipolygons', () => {
    const withHole: Polygon = { type: 'Polygon', coordinates: [square, hole] };
    expect(pointInGeometry([5, 5], withHole)).toBe(false);
    expect(pointInGeometry([2, 2], withHole)).toBe(true);
    const multi: MultiPolygon = {
      type: 'MultiPolygon',
      coordinates: [[square], [[[20, 20], [30, 20], [30, 30], [20, 30], [20, 20]]]],
    };
    expect(pointInGeometry([25, 25], multi)).toBe(true);
    expect(pointInGeometry([15, 15], multi)).toBe(false);
    expect(pointInGeometry([1, 1], null)).toBe(false);
  });
});

describe('label points', () => {
  it('places a label inside a concave shape', () => {
    // A U shape: the middle of its box falls in the notch.
    const u: Polygon = {
      type: 'Polygon',
      coordinates: [[[0, 0], [10, 0], [10, 10], [7, 10], [7, 3], [3, 3], [3, 10], [0, 10], [0, 0]]],
    };
    expect(pointInGeometry(labelPoint(u), u)).toBe(true);
  });

  it('labels the largest part of a multipolygon', () => {
    const m: MultiPolygon = {
      type: 'MultiPolygon',
      coordinates: [[[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]], [square.map((p) => [p[0]! + 50, p[1]!])]],
    };
    expect(labelPoint(m)[0]).toBeGreaterThan(50);
  });

  it('computes boxes and line midpoints', () => {
    expect(bboxOf([{ type: 'Polygon', coordinates: [square] }])).toEqual([0, 0, 10, 10]);
    expect(lineLabelPoint([[[0, 0], [1, 0]], [[0, 0], [0, 10]]])).toEqual([0, 5]);
  });

  it('draws a fraction of the lines', () => {
    const lines: Position[][] = [[[0, 0], [10, 0]], [[0, 1], [10, 1]]];
    expect(partialLines(lines, 0)).toEqual([]);
    expect(partialLines(lines, 0.25)).toEqual([[[0, 0], [5, 0]]]);
    expect(partialLines(lines, 0.75)).toEqual([[[0, 0], [10, 0]], [[0, 1], [5, 1]]]);
    expect(partialLines(lines, 1)).toEqual(lines);
  });
});

describe('landLabelPoint', () => {
  const district: Polygon = { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 4], [0, 4], [0, 0]]] };
  // Water covers the eastern 6 of the 10 degrees, so the land is the western strip.
  const water: Position[][] = [[[4, -1], [11, -1], [11, 5], [4, 5], [4, -1]]];

  it('puts the label on the land part, not in the middle of the district', () => {
    const at = landLabelPoint(district, [water]);
    expect(at[0]).toBeLessThan(4);
    expect(pointInGeometry(at, district)).toBe(true);
  });

  it('is the plain label point when no water touches the district', () => {
    const far: Position[][] = [[[50, 50], [51, 50], [51, 51], [50, 51], [50, 50]]];
    expect(landLabelPoint(district, [far])).toEqual(labelPoint(district));
  });
});
