import { describe, expect, it } from 'vitest';
import { buildWater, countLandParts, mergeLand } from '../../../src/server/features/publish/index.js';

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

describe('countLandParts', () => {
  const district = (n: number, ...g: object[]) => ({ type: 'Feature', properties: { district: n }, geometry: g.length === 1 ? g[0] : { type: 'MultiPolygon', coordinates: g.map((p) => (p as { coordinates: unknown }).coordinates) } });
  const fc = (...f: object[]) => JSON.stringify({ type: 'FeatureCollection', features: f });

  const pt = (district: number, x: number, y: number) => ({ district, point: [x, y] as [number, number] });

  it('counts pieces with people: a tiny populated piece counts, a large unpopulated one does not, two populated is 2', async () => {
    // District 1: big piece plus a 0.001 degree populated strip. District 2: two populated pieces. District 3: big populated piece plus a large empty one. District 4: populated piece plus an unpopulated speck.
    const districts = fc(
      district(1, square(0, 40, 3, 42)),
      district(2, square(0, 30, 3, 32)),
      district(3, square(0, 20, 3, 22)),
      district(4, square(0, 10, 3, 12)),
    );
    const land = await mergeLand([
      square(0, 40, 1.5, 42), square(2.5, 40, 2.501, 40.001),
      square(0, 30, 1, 32), square(2, 30, 3, 32),
      square(0, 20, 1, 22), square(2, 20, 3, 22),
      square(0, 10, 1.5, 12), square(2.5, 11, 2.501, 11.001),
    ]);
    const populated = [
      pt(1, 0.5, 41), pt(1, 2.5005, 40.0005),
      pt(2, 0.5, 31), pt(2, 2.5, 31),
      pt(3, 0.5, 21),
      pt(4, 0.5, 11),
    ];
    expect(await countLandParts(districts, land, 4, populated)).toEqual({ parts: [2, 2, 1, 1], clamped: 0 });
  });

  it('clamps a populated district whose points miss the land to 1 and reports it', async () => {
    const districts = fc(district(1, square(0, 40, 3, 42)), district(2, square(0, 30, 3, 32)));
    const land = await mergeLand([square(0, 40, 1, 42), square(0, 30, 1, 32)]);
    expect(await countLandParts(districts, land, 2, [pt(1, 2, 41)])).toEqual({ parts: [1, 1], clamped: 1 });
  });
});
