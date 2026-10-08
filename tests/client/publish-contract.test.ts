/**
 * Contract between the generator (src/server/features/publish, rule-examples) and the static viewer.
 *
 * Every file the generator writes under public/data is produced here by the REAL writer or builder on a
 * small synthetic input, pushed through the same JSON round trip, and parsed with the CLIENT's own zod
 * schema. A writer-side rename or retype now fails here, not after the data is regenerated.
 *
 * Tests may import from both sides; the schemas are taken from the client model files directly.
 */
/// <reference path="../../src/server/features/publish/mapshaper.d.ts" />
/// <reference path="../../src/server/features/publish/vt-pbf.d.ts" />
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PMTiles } from 'pmtiles';
import type { RangeResponse, Source } from 'pmtiles';
import type { Feature, Polygon } from 'geojson';
import { afterAll, describe, expect, it } from 'vitest';
import {
  BalanceLogSchema, buildBalance, buildCuts, buildIndex, buildStats, buildWater, checkBlocks, encodeBlocks, mergeLand,
  PlanMetricsSchema, planStats, publishedSummaries, toTopology,
} from '../../src/server/features/publish/index.js';
import { unwrapCoordinates, unwrapFeatures } from '../../src/server/features/publish/antimeridian.js';
import { buildDetailTiles } from '../../src/server/features/publish/tiles.js';
import {
  createExtractContext, dataCases, writeRuleExamples, type RuleCase,
} from '../../src/server/features/rule-examples/index.js';
import { buildPublishedBridges } from '../../src/server/features/publish/index.js';
import { STATES } from '../../src/server/shared/apportionment/index.js';
import { parseRuleExamplesConfig } from '../../src/server/shared/config/index.js';
import { BalanceSchema } from '../../src/client/entities/plan/balance';
import { BlocksSchema } from '../../src/client/entities/plan/blocks';
import { BridgesSchema } from '../../src/client/entities/plan/model';
import { CutsSchema, DistrictTopoSchema, EnactedTopoSchema, StatsSchema, WaterTopoSchema } from '../../src/client/entities/plan/model';
import { RuleExamplesSchema } from '../../src/client/entities/rule-example/model';
import { OutlineTopoSchema } from '../../src/client/entities/state/outlines';
import { StateIndexSchema } from '../../src/client/entities/state/model';

/** What the writers' output becomes on disk and in the browser: serialized, then parsed. */
const roundTrip = (v: unknown): unknown => JSON.parse(JSON.stringify(v));

const tmp = mkdtempSync(join(tmpdir(), 'publish-contract-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);

/** A plan's metrics.json with every field the viewer requires, plus the generator-only extras. */
const metricsFor = (seats: number, sha: string) => PlanMetricsSchema.parse({
  state: 'XX', angleStepDeg: 0.1, nodeVersion: 'v24.0.0', inputSha256: SHA_A, seats, population: 200, ideal: 200 / seats,
  districts: Array.from({ length: seats }, (_, i) => ({ district: i + 1, pop: 200 / seats, dev: 0, devPct: 0, contiguous: true })),
  rangePersons: 0, rangePct: 0, allContiguous: true, assignmentSha256: sha,
  cuts: seats - 1, angleCount: 1800, directionsPerCut: Array.from({ length: seats - 1 }, () => 1800), candidateLinesEvaluated: 1800 * (seats - 1),
  strayBlocksMoved: 0, strayPopMoved: 0, recounts: 0, recountsMaxPerCut: 0, balanceMoves: 1, peopleMovedByBalancing: 3,
  rangeBeforeBalancing: 3, rangeAfterBalancing: 0, runtimeMs: 12, countiesSplit: 1, countiesTotal: 2, blocks: 4,
});

const SEATS = 2;
const counties = [[{ fips: '44001', name: 'Bristol County' }], [{ fips: '44003', name: 'Kent County' }]] as const;
const stats = buildStats(planStats(metricsFor(SEATS, SHA_A), counties, [1, 2]), planStats(metricsFor(SEATS, SHA_B), counties, [2, 1]), 'enacted-source');

/** Two unit-ish squares sharing an edge, at a longitude offset (so the same shapes serve the antimeridian case). */
const square = (district: number, x0: number): Feature<Polygon> => ({
  type: 'Feature', properties: { district },
  geometry: { type: 'Polygon', coordinates: [[[x0, 10], [x0 + 0.1, 10], [x0 + 0.1, 10.1], [x0, 10.1], [x0, 10]]] },
});
const districts = { features: [square(1, -100), square(2, -99.9)] };

describe('index.json', () => {
  it('written by publishedSummaries + buildIndex parses with the viewer index schema', async () => {
    const dir = join(tmp, 'index');
    mkdirSync(join(dir, 'RI'), { recursive: true });
    writeFileSync(join(dir, 'RI', 'stats.json'), JSON.stringify(stats));
    const index = buildIndex(STATES, await publishedSummaries(dir));
    const parsed = StateIndexSchema.parse(roundTrip(index));
    expect(parsed.states).toHaveLength(50);
    const ri = parsed.states.find((s) => s.abbr === 'RI')!;
    expect(ri.hasData).toBe(true);
    expect(ri.summary).toMatchObject({ assignmentSha256: SHA_A, inputSha256: SHA_A, population: 200, angleStepDeg: 0.1 });
    expect(parsed.states.find((s) => s.abbr === 'TX')!.summary).toBeUndefined();
  });
});

describe('stats.json', () => {
  it('written by planStats + buildStats parses with the viewer stats schema', () => {
    const parsed = StatsSchema.parse(roundTrip(stats));
    expect(parsed.enactedSource).toBe('enacted-source');
    expect(parsed.finished.metrics.assignmentSha256).toBe(SHA_A);
    expect(parsed.beforeBalancing.metrics.assignmentSha256).toBe(SHA_B);
    expect(parsed.finished.districts[0]!.counties).toEqual([{ fips: '44001', name: 'Bristol County' }]);
    expect(parsed.finished.districts.map((d) => d.landParts)).toEqual([1, 2]);
    expect(parsed.beforeBalancing.districts.map((d) => d.landParts)).toEqual([2, 1]);
  });
});

describe('bridges.json', () => {
  const A = '440010301001000';
  const B = '440010301001001';
  const csv = (a: number, b: number) => `GEOID20,district
${A},${a}
${B},${b}
`;

  it('written by buildPublishedBridges parses with the viewer bridges schema', async () => {
    const dir = join(tmp, 'bridges');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'bridges.json'), JSON.stringify({ links: [{ a: A, b: B, aPoint: [-71.1, 41.5], bPoint: [-71.2, 41.6] }] }));
    const parsed = BridgesSchema.parse(roundTrip(await buildPublishedBridges(dir, 'RI', 1, csv(1, 2), csv(2, 2))));
    expect(parsed.links).toEqual([{ a: [-71.1, 41.5], b: [-71.2, 41.6], finished: [1, 2], before: [2, 2] }]);
  });
  it('the empty case (no links) parses too', async () => {
    const dir = join(tmp, 'bridges-empty');
    mkdirSync(dir, { recursive: true });
    expect(BridgesSchema.parse(roundTrip(await buildPublishedBridges(dir, 'RI', 0, csv(1, 2), csv(1, 2)))).links).toEqual([]);
  });
});

describe('cuts.json', () => {
  const props = (order: number) => ({ order, depth: order - 1, seats: 2, lowSeats: 1, highSeats: 1, firstDistrict: 0, angleDeg: 69.4, lengthM: 61953, strayBlocks: 0, strayPop: 0, recounts: 0 });
  const raw = { features: [{ properties: props(1), geometry: { coordinates: [[[-71.1234567, 41.7654321], [-71.2, 41.8]]] } }] };

  it('written by buildCuts parses with the viewer cuts schema', () => {
    expect(CutsSchema.parse(roundTrip(buildCuts(raw)))).toHaveLength(1);
  });
  it('keeps parsing after publish.ts unwraps an antimeridian state', () => {
    const wrapped = buildCuts({ features: [{ properties: props(1), geometry: { coordinates: [[[179.5, 52], [-179.5, 52.5]]] } }] }).map((c) => ({ ...c, lines: unwrapCoordinates(c.lines) }));
    expect(CutsSchema.parse(roundTrip(wrapped))[0]!.lines[0]![0]![0]).toBe(-180.5);
  });
});

describe('balance.json', () => {
  const log = BalanceLogSchema.parse({
    before: [100, 100],
    moves: [{ block: 4, geoid: '440010301001000', from: 1, to: 2, pop: 3, gain: 20 }],
  });
  const ring: [number, number][] = [[-71.1, 41.7], [-71.0, 41.7], [-71.0, 41.8], [-71.1, 41.8], [-71.1, 41.7]];
  const polygons = new Map([['440010301001000', [[ring]]]]);

  it('written by buildBalance parses with the viewer balance schema', () => {
    const parsed = BalanceSchema.parse(roundTrip(buildBalance(SEATS, log, polygons)));
    expect(parsed.moves).toHaveLength(1);
    expect(Object.keys(parsed.blocks)).toEqual(['440010301001000']);
  });
  it('keeps parsing after publish.ts unwraps an antimeridian state', () => {
    const balance = buildBalance(SEATS, log, new Map([['440010301001000', [[[[179.9, 52], [-179.9, 52], [-179.9, 52.1], [179.9, 52.1], [179.9, 52]]]]]]));
    const blocks = Object.fromEntries(Object.entries(balance.blocks).map(([g, polys]) => [g, unwrapCoordinates(polys)]));
    expect(BalanceSchema.parse(roundTrip({ ...balance, blocks })).moves).toHaveLength(1);
  });
});

describe('blocks.json', () => {
  const csv = (rows: [string, number][]): string => ['GEOID20,district', ...rows.map(([g, d]) => `${g},${d}`)].join('\n') + '\n';
  const finished = csv([['080010078011000', 1], ['080010078011001', 1], ['080010078022000', 2]]);
  const before = csv([['080010078011000', 1], ['080010078011001', 2], ['080010078022000', 2]]);
  const fingerprints = { finished: SHA_A, before: SHA_B };

  it('written by encodeBlocks parses with the viewer blocks schema', () => {
    const file = encodeBlocks('08', SEATS, finished, before, fingerprints);
    checkBlocks(file, finished, before, { state: '08', seats: SEATS, fingerprints });
    const parsed = BlocksSchema.parse(roundTrip(file));
    expect(parsed).toMatchObject({ v: 1, state: '08', seats: SEATS, fingerprints });
    expect(Object.keys(parsed.tracts)).toEqual(['001007801', '001007802']);
  });
});

describe('topology files', () => {
  it('districts.topo.json and before.topo.json (toTopology) parse with the viewer districts schema', async () => {
    const topo = JSON.parse(await toTopology(districts, 'districts', 100));
    expect(DistrictTopoSchema.parse(topo).objects.districts.geometries.map((g) => g.properties.district)).toEqual([1, 2]);
  });

  it('keeps parsing after publish.ts unwraps an antimeridian state (Alaska)', async () => {
    const across = { features: [square(1, 179.9), square(2, -179.95)] };
    const topo = JSON.parse(await toTopology({ features: unwrapFeatures(across.features) }, 'districts', 100));
    expect(DistrictTopoSchema.parse(topo).objects.districts.geometries).toHaveLength(2);
  });

  it('enacted.topo.json parses with the viewer enacted schema', async () => {
    const enacted = ['01', '02'].map((code, i) => ({ type: 'Feature', properties: { label: `Congressional District ${i + 1}`, code }, geometry: square(i + 1, -100 + i / 10).geometry as { coordinates?: unknown } }));
    const topo = JSON.parse(await toTopology({ features: enacted }, 'enacted', 100));
    expect(EnactedTopoSchema.parse(topo).objects.enacted.geometries.map((g) => g.properties.code)).toEqual(['01', '02']);
  });

  it('water.topo.json (buildWater + toTopology) parses with the viewer water schema', async () => {
    // Land covers the western half of the districts; the eastern half is water.
    const land = await mergeLand([{ type: 'Polygon', coordinates: [[[-100.1, 9.9], [-99.9, 9.9], [-99.9, 10.2], [-100.1, 10.2], [-100.1, 9.9]]] }]);
    const water = await buildWater(JSON.stringify({ type: 'FeatureCollection', features: districts.features }), land);
    expect(water.features.length).toBeGreaterThan(0);
    const topo = JSON.parse(await toTopology({ features: water.features }, 'water', 100));
    expect(WaterTopoSchema.parse(topo).objects.water.geometries.length).toBeGreaterThan(0);
  });

  it('states.topo.json parses with the viewer outline schema', async () => {
    const features = ['CO', 'UT'].map((abbr, i) => ({ type: 'Feature', properties: { abbr, name: abbr }, geometry: square(1, -100 + i).geometry as { coordinates?: unknown } }));
    const topo = JSON.parse(await toTopology({ features }, 'states', 100));
    expect(OutlineTopoSchema.parse(topo).objects.states.geometries.map((g) => g.properties.abbr)).toEqual(['CO', 'UT']);
  });
});

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

describe('detail.pmtiles', () => {
  // The viewer applies no zod schema to the tiles; it relies on the five layer ids and on the fingerprints
  // in the metadata matching the blocks.json / stats.json fingerprints. Check both.
  it('carries the five layers and fingerprints that match the viewer-validated blocks and stats files', async () => {
    const water: Feature = { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[-99.95, 10.02], [-99.92, 10.02], [-99.92, 10.05], [-99.95, 10.05], [-99.95, 10.02]]] } };
    const arc: Feature = { type: 'Feature', properties: { a: 1, b: 2 }, geometry: { type: 'LineString', coordinates: [[-99.9, 10], [-99.9, 10.1]] } };
    const fingerprints = { finished: SHA_A, before: SHA_B };
    const bytes = buildDetailTiles({ finished: districts.features, before: districts.features, 'finished-arcs': [arc], 'before-arcs': [arc], water: [water] }, fingerprints);
    const meta = (await new PMTiles(new BufferSource(bytes)).getMetadata()) as { vector_layers: { id: string }[]; fingerprints: unknown };
    expect(meta.vector_layers.map((l) => l.id).sort()).toEqual(['before', 'before-arcs', 'finished', 'finished-arcs', 'water']);
    const parsedStats = StatsSchema.parse(roundTrip(stats));
    expect(meta.fingerprints).toEqual({ finished: parsedStats.finished.metrics.assignmentSha256, before: parsedStats.beforeBalancing.metrics.assignmentSha256 });
  });
});

describe('how/rule-examples.json', () => {
  const ring: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10]];
  /** Exercises every optional field the schema pair knows about. */
  const rich: RuleCase = {
    id: 'rich', state: 'CO', stateName: 'Colorado', source: { cut: 1, move: 2, angleDeg: 12.5 }, link: { state: 'CO', cut: 1, move: 2 }, view: { w: 100, h: 60 },
    blocks: [{ id: 'b1', geoid: '080010078011000', pop: 5, ring, tag: 't', side: 1, district: 3 }],
    lines: [{ id: 'l1', pts: [[0, 0], [5, 5]], tag: 't' }],
    labels: [{ id: 'x1', x: 1, y: 2, text: 'hello', tag: 't' }],
    steps: [{ caption: 'First.', show: ['b1'], hide: ['l1'], set: { b1: 'red' }, tween: [{ id: 'l1', to: [[1, 1], [6, 6]] }] }, { caption: 'Second.', show: ['chart-hi'] }],
    chart: { kind: 'bars', values: [1, 2, 3], marks: { hi: [0, 2] }, baseline: 0, labels: ['a', 'b', 'c'] },
    missing: 'none yet',
  };
  const bare: RuleCase = { id: 'bare', state: 'XX', stateName: 'Xland', source: {}, link: { state: 'XX' }, view: { w: 10, h: 10 }, steps: [{ caption: 'Only.', show: [] }] };

  it('written by writeRuleExamples parses with the viewer rule-example schema, field for field', async () => {
    const dest = join(tmp, 'how', 'rule-examples.json');
    await writeRuleExamples(dest, [rich, bare]);
    const parsed = RuleExamplesSchema.parse(JSON.parse(readFileSync(dest, 'utf8')));
    expect(parsed.version).toBe(1);
    expect(parsed.cases.map((c) => c.id)).toEqual(['bare', 'rich']);
    // The client schema strips unknown keys, so equality proves it knows every key the writer emitted.
    expect(parsed.cases.find((c) => c.id === 'rich')).toEqual(rich);
    expect(parsed.cases.find((c) => c.id === 'bare')).toEqual(bare);
  });

  const cfg = parseRuleExamplesConfig([]);
  it.skipIf(!(existsSync('out/AL/cut-stats.json') && existsSync('out/AL/metrics.json') && existsSync('out/CO/metrics.json') && existsSync('out/CO/balance.json')))(
    'the real data case builders parse with the viewer schema (needs out/AL and out/CO)',
    async () => {
      const ctx = createExtractContext(cfg);
      const cases = [];
      for (const build of dataCases) cases.push(await build(ctx));
      const dest = join(tmp, 'how-real', 'rule-examples.json');
      await writeRuleExamples(dest, cases);
      const parsed = RuleExamplesSchema.parse(JSON.parse(readFileSync(dest, 'utf8')));
      expect(parsed.cases.map((c) => c.id).sort()).toEqual(cases.map((c) => c.id).sort());
    },
  );
});
