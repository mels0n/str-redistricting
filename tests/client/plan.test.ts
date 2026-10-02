import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { feature, neighbors } from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';
import type { FeatureCollection, MultiPolygon, Polygon } from 'geojson';
import {
  CutsSchema,
  StatsSchema,
  assignColors,
  cutSides,
  cutStep,
  districtAt,
  isLastStep,
  pieceSizes,
  piecesAfter,
  stepBy,
  unionNeighbors,
  type Cut,
} from '../../src/client/entities/plan';
import { StateIndexSchema, isGenerated } from '../../src/client/entities/state';
import { labelPoint } from '../../src/client/shared/lib/geo';

const PILOTS = ['RI', 'CT', 'CO', 'MD', 'NC', 'NM', 'MO', 'MI', 'WA', 'LA', 'CA', 'TX'];

const data = (p: string): unknown =>
  JSON.parse(readFileSync(new URL(`../../public/data/${p}`, import.meta.url), 'utf8'));

function districts(abbr: string, file = 'districts.topo.json') {
  const topo = data(`${abbr}/${file}`) as Topology<{ districts: GeometryCollection<{ district: number }> }>;
  const dOf = (g: { properties?: unknown }): number => (g.properties as { district: number }).district;
  const geoms = [...topo.objects.districts.geometries].sort((a, b) => dOf(a) - dOf(b));
  const fc = feature(topo, { ...topo.objects.districts, geometries: geoms }) as FeatureCollection<
    Polygon | MultiPolygon,
    { district: number }
  >;
  return { features: fc.features, neighbors: neighbors(geoms) };
}

describe('published data passes the client schemas', () => {
  it('index and every generated state', () => {
    const index = StateIndexSchema.parse(data('index.json'));
    expect(index.states).toHaveLength(50);
    const generated = index.states.filter(isGenerated);
    expect(generated).toHaveLength(50);
    expect(generated.map((s) => s.abbr)).toEqual(expect.arrayContaining(PILOTS));
    for (const s of generated) {
      const stats = StatsSchema.parse(data(`${s.abbr}/stats.json`));
      const cuts = CutsSchema.parse(data(`${s.abbr}/cuts.json`));
      expect(stats.finished.districts).toHaveLength(s.seats);
      expect(cuts).toHaveLength(s.seats - 1);
      expect(stats.finished.metrics.assignmentSha256).toBe(s.summary.assignmentSha256);
    }
  });

  it('rejects a malformed stats file', () => {
    expect(StatsSchema.safeParse({ enactedSource: 'x' }).success).toBe(false);
  });
});

describe('cut sequence', () => {
  const cut = (order: number, firstDistrict: number, seats: number, lowSeats: number): Cut => ({
    order,
    depth: 0,
    seats,
    lowSeats,
    highSeats: seats - lowSeats,
    firstDistrict,
    angleDeg: 0,
    lengthM: 1,
    lines: [[[0, 0], [1, 1]]],
  });
  // 7 seats split 3 | 4, then each side again, in pre-order.
  const seven = [cut(1, 0, 7, 3), cut(2, 0, 3, 1), cut(3, 1, 2, 1), cut(4, 3, 4, 2), cut(5, 3, 2, 1), cut(6, 5, 2, 1)];

  it('splits pieces in pre-order', () => {
    expect(piecesAfter(seven, 0, 7)).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(piecesAfter(seven, 1, 7)).toEqual([0, 0, 0, 3, 3, 3, 3]);
    expect(piecesAfter(seven, 2, 7)).toEqual([0, 1, 1, 3, 3, 3, 3]);
    expect(piecesAfter(seven, 6, 7)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(piecesAfter(seven, 99, 7)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect([...pieceSizes(piecesAfter(seven, 2, 7)).values()]).toEqual([1, 2, 4]);
  });

  it('adds one piece per cut and ends with one district per piece, for every published state', () => {
    for (const abbr of PILOTS) {
      const cuts = CutsSchema.parse(data(`${abbr}/cuts.json`));
      const seats = cuts.length + 1;
      expect(piecesAfter(cuts, cuts.length, seats)).toEqual(Array.from({ length: seats }, (_, i) => i));
      for (let k = 0; k <= cuts.length; k++) expect(pieceSizes(piecesAfter(cuts, k, seats)).size).toBe(k + 1);
    }
  });

  it('names the districts on each side of a cut', () => {
    expect(cutSides(cut(1, 0, 7, 3))).toEqual({ low: [1, 3], high: [4, 7] });
    expect(cutSides(cut(5, 3, 2, 1))).toEqual({ low: [4, 4], high: [5, 5] });
  });

  it('clamps the scrubber position', () => {
    expect(cutStep(-3, 7)).toEqual({ k: 0, total: 7 });
    expect(cutStep(9, 7)).toEqual({ k: 7, total: 7 });
    expect(cutStep(Number.NaN, 7)).toEqual({ k: 0, total: 7 });
    expect(stepBy(cutStep(6, 7), 1)).toEqual({ k: 7, total: 7 });
    expect(stepBy(cutStep(7, 7), 1)).toEqual({ k: 7, total: 7 });
    expect(stepBy(cutStep(0, 7), -1)).toEqual({ k: 0, total: 7 });
    expect(isLastStep(cutStep(7, 7))).toBe(true);
    expect(isLastStep(cutStep(6, 7))).toBe(false);
  });
});

describe('district colors', () => {
  it('never gives neighbors the same color, for every published state', () => {
    for (const abbr of PILOTS) {
      const adj = unionNeighbors(districts(abbr).neighbors, districts(abbr, 'before.topo.json').neighbors);
      const slots = assignColors(adj, 8);
      adj.forEach((ns, i) => {
        for (const j of ns) expect(slots[j]).not.toBe(slots[i]);
      });
      expect(assignColors(adj, 8)).toEqual(slots);
    }
  });

  it('spreads colors along a chain', () => {
    expect(assignColors([[1], [0, 2], [1]], 4)).toEqual([0, 1, 2]);
  });
});

describe('finding a district', () => {
  const co = districts('CO');

  it('locates every district at its own label point', () => {
    for (const f of co.features) expect(districtAt(co.features, labelPoint(f.geometry))).toBe(f.properties.district);
  });

  it('returns null outside the state', () => {
    expect(districtAt(co.features, [-120, 45])).toBeNull();
  });

  it('finds a district for the Colorado State Capitol', () => {
    expect(districtAt(co.features, [-104.984403, 39.739997])).not.toBeNull();
  });
});
