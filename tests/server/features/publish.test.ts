import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  buildCuts, buildIndex, countiesByDistrict, parseCdRecord, planStats, simplifyPercent, toTopology, vertexCount,
  boundaryUrl, CountyRecord, PlanMetricsSchema, publishedSummaries, summarize,
} from '../../../src/server/features/publish/index.js';
import { STATES } from '../../../src/server/shared/apportionment/index.js';
import { parsePublishConfig } from '../../../src/server/shared/config/index.js';
import { DataError } from '../../../src/server/shared/errors/index.js';

const names = new Map([['44001', 'Bristol County'], ['44003', 'Kent County'], ['44007', 'Providence County']]);

describe('countiesByDistrict', () => {
  it('lists each district counties by the first five GEOID characters, sorted, without repeats', () => {
    const csv = 'GEOID20,district\n440070301001000,2\n440010301001000,1\n440010301001001,1\n440030301001000,1\n440070301001001,1\n';
    expect(countiesByDistrict(csv, 2, names)).toEqual([
      [{ fips: '44001', name: 'Bristol County' }, { fips: '44003', name: 'Kent County' }, { fips: '44007', name: 'Providence County' }],
      [{ fips: '44007', name: 'Providence County' }],
    ]);
  });
  it('rejects a county missing from the name file and a district out of range', () => {
    expect(() => countiesByDistrict('GEOID20,district\n449990301001000,1\n', 1, names)).toThrow(DataError);
    expect(() => countiesByDistrict('GEOID20,district\n440010301001000,3\n', 2, names)).toThrow(DataError);
  });
});

describe('cuts', () => {
  const props = { order: 1, depth: 0, seats: 2, lowSeats: 1, highSeats: 1, firstDistrict: 0, angleDeg: 69.4, lengthM: 61953 };
  it('keeps order, range fields and rounds line coordinates to 5 decimals', () => {
    const raw = { features: [
      { properties: { ...props, order: 2, depth: 1, firstDistrict: 1 }, geometry: { coordinates: [[[-71.1234567, 41.7654321], [-71.2, 41.8]]] } },
      { properties: props, geometry: { coordinates: [[[-71.788682, 41.69465], [-71.345313, 41.819246]]] } },
    ] };
    const cuts = buildCuts(raw);
    expect(cuts.map((c) => c.order)).toEqual([1, 2]);
    expect(cuts[0]).toMatchObject({ firstDistrict: 0, lowSeats: 1, highSeats: 1, lines: [[[-71.78868, 41.69465], [-71.34531, 41.81925]]] });
    expect(cuts[1]!.lines[0]![0]).toEqual([-71.12346, 41.76543]);
  });
  it('rejects a cut without firstDistrict', () => {
    const { firstDistrict: _f, ...rest } = props;
    expect(() => buildCuts({ features: [{ properties: rest, geometry: { coordinates: [] } }] })).toThrow();
  });
});

describe('index assembly', () => {
  const metrics = PlanMetricsSchema.parse({
    state: 'RI', angleStepDeg: 0.1, nodeVersion: 'v24.12.0', inputSha256: 'a', seats: 2, population: 10, ideal: 5,
    districts: [{ district: 1, pop: 5, dev: 0, devPct: 0, contiguous: true }], rangePersons: 1, rangePct: 0.1, allContiguous: true,
    assignmentSha256: 'b', balanceMoves: 1,
  });
  it('lists all 50 states and flags the ones with data', () => {
    const idx = buildIndex(STATES, new Map([['RI', summarize(metrics)]]));
    expect(idx.states).toHaveLength(50);
    const ri = idx.states.find((s) => s.abbr === 'RI')!;
    expect(ri).toMatchObject({ name: 'Rhode Island', seats: 2, hasData: true, summary: { population: 10, assignmentSha256: 'b' } });
    expect(ri.summary).not.toHaveProperty('generated');
    const tx = idx.states.find((s) => s.abbr === 'TX')!;
    expect(tx).toEqual({ abbr: 'TX', name: 'Texas', seats: 38, hasData: false });
  });
  it('planStats keeps extra metrics fields and attaches counties to districts', () => {
    const s = planStats(metrics, [[{ fips: '44001', name: 'Bristol County' }]]);
    expect(s.metrics).toMatchObject({ balanceMoves: 1, population: 10 });
    expect(s.metrics).not.toHaveProperty('districts');
    expect(s.districts[0]).toMatchObject({ district: 1, pop: 5, counties: [{ fips: '44001', name: 'Bristol County' }] });
  });
});

describe('boundary records', () => {
  it('finds the district code column whatever the Congress number', () => {
    expect(parseCdRecord({ STATEFP: '44', NAMELSAD: 'Congressional District 1', CD119FP: '01', GEOID: '4401' })).toEqual({ stateFp: '44', label: 'Congressional District 1', code: '01' });
    expect(parseCdRecord({ STATEFP: '02', NAMELSAD: 'Congressional District (at Large)', CD118FP: '00' }).code).toBe('00');
  });
  it('rejects records missing required fields', () => {
    expect(() => parseCdRecord({ STATEFP: '44', NAMELSAD: 'x' })).toThrow();
    expect(() => parseCdRecord({ STATEFP: '4', NAMELSAD: 'x', CD119FP: '01' })).toThrow();
    expect(() => CountyRecord.parse({ STATEFP: '44', COUNTYFP: '1', NAMELSAD: 'Kent County' })).toThrow();
  });
  it('builds the Census URL from the vintage in the file name', () => {
    expect(boundaryUrl('cb_2025_us_cd119_500k')).toBe('https://www2.census.gov/geo/tiger/GENZ2025/shp/cb_2025_us_cd119_500k.zip');
  });
});

describe('topology', () => {
  const sq = (x0: number, d: number) => ({
    type: 'Feature', properties: { district: d },
    geometry: { type: 'Polygon', coordinates: [[[x0, 0], [x0 + 1, 0], [x0 + 1, 0.5], [x0 + 1, 1], [x0, 1], [x0, 0.5], [x0, 0]]] },
  });
  const fc = { features: [sq(0, 1), sq(1, 2)] };
  it('counts vertices and caps the kept share at 100 percent', () => {
    expect(vertexCount(fc)).toBe(14);
    expect(simplifyPercent(14, 1000)).toBe(100);
    expect(simplifyPercent(1000, 100)).toBeCloseTo(10);
  });
  it('writes TopoJSON in which neighbours share their border arc and keep their properties', async () => {
    const topo = JSON.parse(await toTopology(fc, 'districts', 5)) as { type: string; arcs: unknown[]; objects: { districts: { geometries: { arcs: number[][][]; properties: { district: number } }[] } } };
    expect(topo.type).toBe('Topology');
    const [a, b] = topo.objects.districts.geometries;
    expect(a!.properties.district).toBe(1);
    const flat = (g: typeof a) => g!.arcs.flat(2).map((i) => (i < 0 ? ~i : i));
    expect(flat(a).filter((i) => flat(b).includes(i)).length).toBeGreaterThan(0);
  });
});

describe('publish config', () => {
  it('defaults to every state and the standard directories', () => {
    expect(parsePublishConfig([])).toEqual({ states: undefined, cacheDir: 'data/raw', outDir: 'out', publicDir: 'public/data' });
  });
  it('rejects an unknown state', () => {
    expect(() => parsePublishConfig(['--states', 'ZZ'])).toThrow();
  });
});

describe('published index', () => {
  const dir = mkdtempSync(join(tmpdir(), 'str-publish-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const { districts: _d, ...published } = PlanMetricsSchema.parse({
    state: 'RI', angleStepDeg: 0.1, nodeVersion: 'v24.12.0', inputSha256: 'a', seats: 2, population: 10, ideal: 5,
    districts: [{ district: 1, pop: 5, dev: 0, devPct: 0, contiguous: true }], rangePersons: 1, rangePct: 0.1, allContiguous: true,
    assignmentSha256: 'b',
  });

  it('lists only the states whose files are in the public directory', async () => {
    mkdirSync(join(dir, 'RI'));
    writeFileSync(join(dir, 'RI', 'stats.json'), JSON.stringify({ official: { metrics: published } }));
    // A state that was generated but not published (no stats.json) must not appear.
    mkdirSync(join(dir, 'CT'));
    const summaries = await publishedSummaries(dir);
    expect([...summaries.keys()]).toEqual(['RI']);
    const idx = buildIndex(STATES, summaries);
    expect(idx.states.filter((s) => s.hasData).map((s) => s.abbr)).toEqual(['RI']);
    expect(idx.states.find((s) => s.abbr === 'CT')).toEqual({ abbr: 'CT', name: 'Connecticut', seats: 5, hasData: false });
    expect(idx.states.find((s) => s.abbr === 'RI')!.summary).toMatchObject({ population: 10, assignmentSha256: 'b' });
  });
  it('rejects a published stats file with the wrong shape', async () => {
    writeFileSync(join(dir, 'CT', 'stats.json'), JSON.stringify({ official: { metrics: { state: 'CT' } } }));
    await expect(publishedSummaries(dir)).rejects.toThrow(DataError);
  });
});

describe('published Rhode Island plan', () => {
  it('keeps the official assignment hash the generator is pinned to', () => {
    const stats = JSON.parse(readFileSync(new URL('../../../public/data/RI/stats.json', import.meta.url), 'utf8')) as { official: { metrics: { assignmentSha256: string } } };
    expect(stats.official.metrics.assignmentSha256.startsWith('1f64bc2dbea6')).toBe(true);
  });
});
