import { describe, expect, it } from 'vitest';
import { districtArcs } from '../../../src/server/features/publish/arcs.js';

type Ring = [number, number][];
const sq = (x: number, y: number, s = 1): Ring => [[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]];
const feat = (district: number, ...rings: Ring[]) => ({ type: 'Feature', properties: { district }, geometry: { type: 'Polygon', coordinates: rings } });
const key = (p: [number, number]): string => `${p[0]},${p[1]}`;

describe('districtArcs', () => {
  const plan = { features: [feat(1, sq(0.125, 0)), feat(2, sq(1.125, 0)), feat(3, sq(2.125, 0))] };

  it('tags arcs with the districts on each side', async () => {
    const arcs = await districtArcs(plan);
    const pairs = arcs.map((f) => `${f.properties.a}-${f.properties.b}`);
    expect(pairs.filter((p) => p === '1-2')).toHaveLength(1);
    expect(pairs.filter((p) => p === '2-3')).toHaveLength(1);
    expect(pairs).not.toContain('1-3');
    expect(arcs.every((f) => f.properties.b === 0 || f.properties.a < f.properties.b)).toBe(true);
  });

  it('keeps every input vertex and covers the outer edge with b=0 arcs', async () => {
    const arcs = await districtArcs(plan);
    const got = new Set(arcs.flatMap((f) => f.geometry.coordinates.map(key)));
    const want = new Set(plan.features.flatMap((f) => f.geometry.coordinates[0]!.map(key)));
    expect(got).toEqual(want);
    const outer = new Set(arcs.filter((f) => f.properties.b === 0).flatMap((f) => f.geometry.coordinates.map(key)));
    expect(outer.has(key([0.125, 0]))).toBe(true);
    expect(outer.has(key([3.125, 1]))).toBe(true);
    expect(arcs.some((f) => f.properties.b === 0 && f.properties.a === 2)).toBe(true);
  });

  it('marks a hole as outer edge only where nothing fills it', async () => {
    const donut = feat(1, sq(0, 0, 4), sq(1, 1, 2));
    const open = await districtArcs({ features: [donut] });
    expect(open.every((f) => f.properties.b === 0)).toBe(true);
    const filled = await districtArcs({ features: [donut, feat(2, sq(1, 1, 2))] });
    const pairs = filled.map((f) => `${f.properties.a}-${f.properties.b}`);
    expect(pairs).toContain('1-2');
    expect(pairs).toContain('1-0');
    expect(pairs).not.toContain('2-0');
  });

  it('drops seams between two features of the same district', async () => {
    const arcs = await districtArcs({ features: [feat(1, sq(0, 0)), feat(1, sq(1, 0)), feat(2, sq(5, 5))] });
    const seam = arcs.find((f) => f.geometry.coordinates.every((c) => c[0] === 1));
    expect(seam).toBeUndefined();
    expect(arcs.some((f) => f.properties.a === 1 && f.properties.b === 0)).toBe(true);
    expect(arcs.some((f) => f.properties.a === 2 && f.properties.b === 0)).toBe(true);
    expect(arcs.every((f) => f.properties.b === 0 || f.properties.a < f.properties.b)).toBe(true);
  });

  it('throws when three districts overlap on one arc', async () => {
    await expect(districtArcs({ features: [feat(1, sq(0, 0)), feat(2, sq(0, 0)), feat(3, sq(0, 0))] })).rejects.toThrow(/more than two/);
  });

  it('rejects invalid district numbers', async () => {
    await expect(districtArcs({ features: [feat(0, sq(0, 0))] })).rejects.toThrow(/invalid district/);
    await expect(districtArcs({ features: [feat(1.5, sq(0, 0))] })).rejects.toThrow(/invalid district/);
  });

  it('handles a MultiPolygon whose parts border different districts', async () => {
    const multi = { type: 'Feature', properties: { district: 2 }, geometry: { type: 'MultiPolygon', coordinates: [[sq(1, 0)], [sq(-2, 0)]] } };
    const arcs = await districtArcs({ features: [feat(1, sq(0, 0)), multi, feat(3, sq(-3, 0))] });
    const pairs = arcs.map((f) => `${f.properties.a}-${f.properties.b}`);
    expect(pairs).toContain('1-2');
    expect(pairs).toContain('2-3');
    expect(pairs).not.toContain('1-3');
  });

  it('is deterministic', async () => {
    expect(await districtArcs(plan)).toEqual(await districtArcs(plan));
  });
});
