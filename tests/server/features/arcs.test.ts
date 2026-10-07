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
});
