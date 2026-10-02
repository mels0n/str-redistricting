import { describe, expect, it } from 'vitest';
import { buildWater, mergeLand } from '../../../src/server/features/publish/index.js';

const square = (x0: number, y0: number, x1: number, y1: number) => ({
  type: 'Polygon' as const,
  coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]],
});
const collection = (...geometry: object[]) => JSON.stringify({ type: 'FeatureCollection', features: geometry.map((g) => ({ type: 'Feature', properties: {}, geometry: g })) });

function area(coords: unknown): number {
  const ring = (r: number[][]): number => {
    let a = 0;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j]![0]! * r[i]![1]! - r[i]![0]! * r[j]![1]!;
    return Math.abs(a) / 2;
  };
  return (coords as number[][][][]).reduce((t, poly) => t + ring(poly[0]!) - poly.slice(1).reduce((h, r) => h + ring(r), 0), 0);
}
const polys = (g: { type?: string; coordinates?: unknown }): unknown => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates);

describe('buildWater', () => {
  // Districts cover (0,40)-(2,42). Land covers the western half (to x=1).
  const districts = collection(square(0, 40, 1, 42), square(1, 40, 2, 42));

  it('is the area the districts cover, less the land', async () => {
    const land = await mergeLand([square(-5, 30, 1, 50)]);
    const water = await buildWater(districts, land);
    expect(water.features).toHaveLength(1);
    const a = area(polys(water.features[0]!.geometry));
    // The eastern half is 1 x 2 degrees; the mask runs a few hundred metres past the district edge.
    expect(a).toBeGreaterThan(2);
    expect(a).toBeLessThan(2.1);
    // Nothing of the land is left in the mask: its west edge is the shoreline at x = 1.
    const xs = (polys(water.features[0]!.geometry) as number[][][][]).flat(2).map((p) => p[0]!);
    expect(Math.min(...xs)).toBeGreaterThan(0.999);
  });

  it('is empty for a state that is all land', async () => {
    const land = await mergeLand([square(-5, 30, 5, 50)]);
    expect((await buildWater(districts, land)).features).toHaveLength(0);
  });

  it('merges neighbouring land so a shared border leaves no sliver', async () => {
    const land = await mergeLand([square(-5, 30, 1, 50), square(1, 30, 5, 50)]);
    expect((await buildWater(districts, land)).features).toHaveLength(0);
  });
});
