import { describe, expect, it } from 'vitest';
import { buildTopology } from '../../../src/server/entities/census-block/index.js';
import { DataError } from '../../../src/server/shared/errors/index.js';
import { bordersGeoJson, chainRings, districtsGeoJson } from '../../../src/server/features/export/index.js';
import { gridBlocks } from '../../helpers/grid.js';

describe('bordersGeoJson', () => {
  it('outlines each district with its boundary edges', () => {
    const blocks = gridBlocks(2, 1);
    const fc = bordersGeoJson(buildTopology(blocks), Int32Array.from([0, 1]), 2) as {
      features: { properties: { district: number }; geometry: { coordinates: unknown[] } }[];
    };
    expect(fc.features.map((f) => f.properties.district)).toEqual([1, 2]);
    expect(fc.features[0]!.geometry.coordinates).toHaveLength(4);
  });
});

type PolyFC = { features: { properties: { district: number }; geometry: { type: string; coordinates: number[][][][] } }[] };

describe('districtsGeoJson', () => {
  it('builds one filled polygon per simple district', () => {
    const blocks = gridBlocks(2, 1);
    const fc = districtsGeoJson(buildTopology(blocks), Int32Array.from([0, 1]), 2) as PolyFC;
    expect(fc.features).toHaveLength(2);
    const poly = fc.features[0]!.geometry.coordinates;
    expect(fc.features[0]!.geometry.type).toBe('MultiPolygon');
    expect(poly).toHaveLength(1);        // one polygon
    expect(poly[0]).toHaveLength(1);     // no holes
    expect(poly[0]![0]).toHaveLength(5); // 4 corners, closed
  });
  it('cuts a hole where another district sits inside', () => {
    // 3x3 grid: center block (index 4) is district 2, the ring around it is district 1.
    const blocks = gridBlocks(3, 3);
    const assignment = Int32Array.from(blocks.map((_, i) => (i === 4 ? 1 : 0)));
    const fc = districtsGeoJson(buildTopology(blocks), assignment, 2) as PolyFC;
    const outer = fc.features[0]!.geometry.coordinates;
    expect(outer).toHaveLength(1);
    expect(outer[0]).toHaveLength(2); // shell + one hole
  });
});

const noRepeats = (ring: number[][]) => {
  const keys = ring.slice(0, -1).map((p) => p.join(','));
  return new Set(keys).size === keys.length;
};

describe('districtsGeoJson pinch points', () => {
  it('splits a district touching itself at one corner into two simple polygons', () => {
    const blocks = gridBlocks(2, 2);
    const fc = districtsGeoJson(buildTopology(blocks), Int32Array.from([0, 1, 1, 0]), 2) as PolyFC;
    const polys = fc.features[0]!.geometry.coordinates;
    expect(polys).toHaveLength(2);
    for (const poly of polys) {
      expect(poly).toHaveLength(1);
      expect(poly[0]).toHaveLength(5);
      expect(noRepeats(poly[0]!)).toBe(true);
    }
  });
  it('never repeats a vertex inside a ring when a larger shape pinches itself', () => {
    // 3x3 grid: district 0 = blocks 0,1,4,8; blocks 4 and 8 meet only at a corner.
    const blocks = gridBlocks(3, 3);
    const assignment = Int32Array.from(blocks.map((_, i) => ([0, 1, 4, 8].includes(i) ? 0 : 1)));
    const fc = districtsGeoJson(buildTopology(blocks), assignment, 2) as PolyFC;
    for (const f of fc.features) {
      for (const poly of f.geometry.coordinates) {
        for (const ring of poly) {
          expect(ring[0]).toEqual(ring[ring.length - 1]);
          expect(noRepeats(ring)).toBe(true);
        }
      }
    }
  });
});

describe('chainRings', () => {
  it('throws DataError when the boundary does not close', () => {
    const segs: [[number, number], [number, number]][] = [
      [[0, 0], [1, 0]],
      [[1, 0], [1, 1]],
    ];
    expect(() => chainRings(segs, 3)).toThrow(DataError);
    expect(() => chainRings(segs, 3)).toThrow(/district 3/);
  });
});
