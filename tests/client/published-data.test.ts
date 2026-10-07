import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PMTiles } from 'pmtiles';
import type { RangeResponse, Source } from 'pmtiles';
import { feature } from 'topojson-client';
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson';
import { describe, expect, it } from 'vitest';
import { BlocksSchema } from '../../src/client/entities/plan/blocks';
import { BalanceSchema } from '../../src/client/entities/plan/balance';
import { CutsSchema, DistrictTopoSchema, EnactedTopoSchema, StatsSchema, WaterTopoSchema } from '../../src/client/entities/plan/model';
import { StateIndexSchema } from '../../src/client/entities/state';
import { bboxOf, openingBox, pointInGeometry, toStateFrame } from '../../src/client/shared/lib/geo';

const dir = join(process.cwd(), 'public', 'data');
const read = (...p: string[]): unknown => JSON.parse(readFileSync(join(dir, ...p), 'utf8'));
const collection = (topo: unknown, name: string): FeatureCollection<Polygon | MultiPolygon> => {
  const t = topo as { objects: Record<string, never> };
  return feature(t as never, t.objects[name]!) as unknown as FeatureCollection<Polygon | MultiPolygon>;
};

class BufferSource implements Source {
  constructor(private readonly bytes: Uint8Array) {}
  getKey(): string {
    return 'buffer';
  }
  async getBytes(offset: number, length: number): Promise<RangeResponse> {
    const slice = this.bytes.slice(offset, offset + length);
    return { data: slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.byteLength) as ArrayBuffer };
  }
}

const index = StateIndexSchema.parse(read('index.json'));

describe('the published data covers all 50 states', () => {
  it('lists 50 states, each with a map', () => {
    expect(index.states).toHaveLength(50);
    expect(index.states.filter((s) => s.hasData && s.summary)).toHaveLength(50);
    expect(index.states.reduce((a, s) => a + s.seats, 0)).toBe(435);
  });

  for (const s of index.states) {
    it(`${s.abbr}: every file passes the viewer's checks`, () => {
      expect(existsSync(join(dir, s.abbr, 'stats.json'))).toBe(true);
      const stats = StatsSchema.parse(read(s.abbr, 'stats.json'));
      expect(stats.finished.metrics.seats).toBe(s.seats);
      expect(stats.finished.districts).toHaveLength(s.seats);
      expect(CutsSchema.parse(read(s.abbr, 'cuts.json'))).toHaveLength(s.seats - 1);
      BalanceSchema.parse(read(s.abbr, 'balance.json'));
      EnactedTopoSchema.parse(read(s.abbr, 'enacted.topo.json'));
      WaterTopoSchema.parse(read(s.abbr, 'water.topo.json'));
      for (const f of ['districts', 'before']) {
        const topo = DistrictTopoSchema.parse(read(s.abbr, `${f}.topo.json`));
        const fc = collection(topo, 'districts');
        expect(fc.features).toHaveLength(s.seats);
        // A map frame that spans most of the world means a shape was drawn across the antimeridian.
        const box = bboxOf(fc.features.map((x) => x.geometry))!;
        expect(box[2] - box[0]).toBeLessThan(70);
      }
    });
  }
});

describe('the detail tiles and block lookup', () => {
  for (const s of index.states) {
    it(`${s.abbr}: blocks.json passes the viewer's schema and detail.pmtiles has the five layers`, async () => {
      const fips = (read(s.abbr, 'blocks.json') as { state: string }).state;
      const blocks = BlocksSchema.parse(read(s.abbr, 'blocks.json'));
      expect(blocks.seats).toBe(s.seats);
      expect(blocks.state).toBe(fips);
      expect(Object.keys(blocks.tracts).length).toBeGreaterThan(0);
      const header = await new PMTiles(new BufferSource(readFileSync(join(dir, s.abbr, 'detail.pmtiles')))).getMetadata();
      const layers = (header as { vector_layers: { id: string }[] }).vector_layers.map((l) => l.id).sort();
      expect(layers).toEqual(['before', 'before-arcs', 'finished', 'finished-arcs', 'water']);
    });
  }
});

describe('the water mask', () => {
  it('rejects a file that is not a water topology', () => {
    expect(WaterTopoSchema.safeParse({ type: 'Topology', arcs: [], objects: { districts: { type: 'GeometryCollection', geometries: [] } } }).success).toBe(false);
    expect(WaterTopoSchema.safeParse({ type: 'Topology', arcs: [], objects: { water: { type: 'GeometryCollection', geometries: [] } } }).success).toBe(true);
  });

  it('covers the Great Lakes for Michigan and none of Michigan’s Detroit', () => {
    const water = collection(read('MI', 'water.topo.json'), 'water');
    const inWater = (pt: [number, number]): boolean => water.features.some((f) => pointInGeometry(pt, f.geometry));
    expect(inWater([-87.0, 44.0])).toBe(true); // Lake Michigan
    expect(inWater([-82.5, 44.9])).toBe(true); // Lake Huron
    expect(inWater([-83.05, 42.33])).toBe(false); // Detroit
    expect(inWater([-84.55, 42.73])).toBe(false); // Lansing
  });

  it('is drawn in the same continuous frame as the districts for Alaska', () => {
    const fc = collection(read('AK', 'water.topo.json'), 'water');
    const box = bboxOf(fc.features.map((f) => f.geometry))!;
    expect(box[2]).toBeLessThan(0);
    expect(box[2] - box[0]).toBeLessThan(70);
  });
});

describe('Alaska is drawn in one continuous frame', () => {
  for (const [file, object] of [['districts', 'districts'], ['before', 'districts'], ['enacted', 'enacted']] as const) {
    it(`${file} has no eastern-hemisphere longitude`, () => {
      const fc = collection(read('AK', `${file}.topo.json`), object);
      const box = bboxOf(fc.features.map((f) => f.geometry))!;
      expect(box[2]).toBeLessThan(0);
      expect(box[0]).toBeLessThan(-180);
      expect(box[2] - box[0]).toBeLessThan(70);
    });
  }

  it('finds the district for a point in the western Aleutians', () => {
    const fc = collection(read('AK', 'districts.topo.json'), 'districts');
    const feats = fc.features as Feature<Polygon | MultiPolygon>[];
    // Attu, at about 172.9 E, as the address search reports it.
    const attu: [number, number] = [172.9, 52.9];
    expect(feats.some((f) => pointInGeometry(attu, f.geometry))).toBe(false);
    expect(feats.some((f) => pointInGeometry(toStateFrame('AK', attu), f.geometry))).toBe(true);
    // Anchorage is unchanged.
    expect(toStateFrame('AK', [-149.9, 61.2])).toEqual([-149.9, 61.2]);
  });

  it('leaves other states alone', () => {
    expect(toStateFrame('HI', [-157.8, 21.3])).toEqual([-157.8, 21.3]);
    expect(toStateFrame('WA', [120, 40])).toEqual([120, 40]);
  });
});

describe('where a state opens', () => {
  it('opens Hawaii on its main islands, inside what is drawn, and every other state on everything', () => {
    const fc = collection(read('HI', 'districts.topo.json'), 'districts');
    const all = bboxOf(fc.features.map((f) => f.geometry))!;
    const box = openingBox('HI', all);
    expect(box[0]).toBeGreaterThan(all[0]);
    expect(box[2] - box[0]).toBeLessThan(10);
    expect(openingBox('CO', all)).toBe(all);
  });
});
