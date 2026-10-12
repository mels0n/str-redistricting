import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { PMTiles } from 'pmtiles';
import type { RangeResponse, Source } from 'pmtiles';
import { feature } from 'topojson-client';
import type { FeatureCollection, MultiPolygon, Polygon } from 'geojson';
import { describe, expect, it } from 'vitest';
import { BlocksSchema } from '../../src/client/entities/plan/blocks';
import { BalanceSchema } from '../../src/client/entities/plan/balance';
import { BridgesSchema, CutsSchema, DistrictTopoSchema, EnactedTopoSchema, StatsSchema, WaterTopoSchema } from '../../src/client/entities/plan/model';
import { STATE_FIPS, StateIndexSchema } from '../../src/client/entities/state';
import { ENACTED } from '../../src/client/shared/config';
import { bboxOf } from '../../src/client/shared/lib/geo';

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

const CHAMBERS = [
  { chamber: 'state-house', suffix: 'sldl' },
  { chamber: 'state-senate', suffix: 'sldu' },
] as const;

const index = StateIndexSchema.parse(read('index.json'));
const versions = read('versions.json') as { engine: string; input: unknown; maps: number };
const major = (v: string): string => v.split('.')[0]!;
const fipsOf = (abbr: string): string => Object.keys(STATE_FIPS).find((k) => STATE_FIPS[k] === abbr)!;

// An index made before the state chambers existed has nothing to check.
const hasChambers = index.states.some((s) => s.chambers !== undefined);
const suite = hasChambers ? describe : describe.skip;

suite('the published state chamber data agrees with the index', () => {
  it('has a folder for every chamber with data, and none for a chamber a state does not have', () => {
    for (const s of index.states) {
      for (const { chamber } of CHAMBERS) {
        const c = s.chambers?.[chamber];
        const folder = join(dir, s.abbr, chamber);
        if (c?.hasData) {
          expect(existsSync(join(folder, 'stats.json')), `${s.abbr} ${chamber} stats.json`).toBe(true);
          expect(c.seats, `${s.abbr} ${chamber} seats`).toBeGreaterThan(0);
          expect(c.summary, `${s.abbr} ${chamber} summary`).toBeDefined();
        } else {
          expect(existsSync(folder), `${s.abbr} ${chamber} has a folder but no data in the index`).toBe(false);
        }
        if (c?.seats === 0) expect(existsSync(folder), `${s.abbr} ${chamber} has no seats`).toBe(false);
      }
    }
  });

  it('has no chamber folder on disk that the index does not list', () => {
    const known = new Set(index.states.map((s) => s.abbr));
    for (const abbr of readdirSync(dir)) {
      if (!known.has(abbr) || !statSync(join(dir, abbr)).isDirectory()) continue;
      for (const { chamber } of CHAMBERS) {
        if (!existsSync(join(dir, abbr, chamber))) continue;
        const entry = index.states.find((s) => s.abbr === abbr)!.chambers?.[chamber];
        expect(entry?.hasData, `${abbr}/${chamber} is on disk but not listed with data`).toBe(true);
      }
    }
  });

  it('gives Nebraska no State House', () => {
    const ne = index.states.find((s) => s.abbr === 'NE');
    if (ne?.chambers) expect(ne.chambers['state-house']?.seats ?? 0).toBe(0);
  });
});

for (const { chamber, suffix } of CHAMBERS) {
  const withData = index.states.filter((s) => s.chambers?.[chamber]?.hasData);

  suite(`${chamber}: every published file passes the viewer's checks`, () => {
    it('is published for at least one state', () => {
      expect(withData.length).toBeGreaterThan(0);
    });

    for (const s of withData) {
      const seats = s.chambers![chamber]!.seats;
      it(`${s.abbr}: files, schemas and counts agree`, async () => {
        const f = (name: string): unknown => read(s.abbr, chamber, name);
        const stats = StatsSchema.parse(f('stats.json'));
        expect(stats.finished.metrics.seats).toBe(seats);
        expect(stats.finished.districts).toHaveLength(seats);
        expect(stats.finished.metrics.allContiguous, `${s.abbr} ${chamber} contiguous`).toBe(true);
        expect(stats.beforeBalancing.districts).toHaveLength(seats);
        expect(CutsSchema.parse(f('cuts.json'))).toHaveLength(seats - 1);
        expect(stats.finished.districts.map((d) => d.district)).toEqual(Array.from({ length: seats }, (_, i) => i + 1));
        for (const plan of [stats.finished, stats.beforeBalancing]) for (const d of plan.districts) expect(d.landParts, `${s.abbr} district ${d.district}`).toBeGreaterThanOrEqual(1);
        BalanceSchema.parse(f('balance.json'));
        EnactedTopoSchema.parse(f('enacted.topo.json'));
        WaterTopoSchema.parse(f('water.topo.json'));

        const bridges = BridgesSchema.parse(f('bridges.json'));
        expect(bridges.links.length, `${s.abbr} links`).toBe(stats.finished.metrics.bridges);
        for (const l of bridges.links) for (const d of [...l.finished, ...l.before]) expect(d >= 1 && d <= seats, `${s.abbr} link district ${d}`).toBe(true);

        for (const name of ['districts', 'before']) {
          const topo = DistrictTopoSchema.parse(f(`${name}.topo.json`));
          const fc = collection(topo, 'districts');
          expect(fc.features).toHaveLength(seats);
          // A map frame that spans most of the world means a shape was drawn across the antimeridian.
          const box = bboxOf(fc.features.map((x) => x.geometry))!;
          expect(box[2] - box[0]).toBeLessThan(70);
        }

        // The block lookup and the tiles carry the same fingerprints as the stats.
        const blocks = BlocksSchema.parse(f('blocks.json'));
        expect(blocks.seats).toBe(seats);
        expect(STATE_FIPS[blocks.state]).toBe(s.abbr);
        expect(Object.keys(blocks.tracts).length).toBeGreaterThan(0);
        const want = { finished: stats.finished.metrics.assignmentSha256, before: stats.beforeBalancing.metrics.assignmentSha256 };
        expect(blocks.fingerprints).toEqual(want);
        const meta = (await new PMTiles(new BufferSource(readFileSync(join(dir, s.abbr, chamber, 'detail.pmtiles')))).getMetadata()) as { vector_layers: { id: string }[]; fingerprints: unknown };
        expect(meta.vector_layers.map((l) => l.id).sort()).toEqual(['before', 'before-arcs', 'finished', 'finished-arcs', 'water']);
        expect(meta.fingerprints).toEqual(want);
        if (seats > 1) expect(existsSync(join(dir, s.abbr, chamber, 'blocks.pmtiles')), `${s.abbr} ${chamber} blocks.pmtiles`).toBe(true);

        // The share image is a real PNG.
        const og = join(dir, s.abbr, chamber, 'og.png');
        expect(existsSync(og)).toBe(true);
        expect([...readFileSync(og).subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

        // The enacted districts come from the pinned legislative vintage.
        expect(stats.enactedSource).toBe(`cb_${ENACTED.legislativeVintage}_${fipsOf(s.abbr)}_${suffix}_500k`);

        // Stamped with the versions the data was made under.
        expect(stats.versions, `${s.abbr} ${chamber} versions`).toBeDefined();
        expect(stats.versions!.maps).toBe(versions.maps);
        expect(stats.versions!.input).toEqual(versions.input);
        expect(major(stats.versions!.engine)).toBe(major(versions.engine));
      });
    }
  });
}
