import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { blocksFileName } from '../../../src/server/entities/census-block/index.js';
import { stateByAbbr, STATES } from '../../../src/server/shared/apportionment/index.js';
import { seatsFor } from '../../../src/server/shared/chamber/index.js';
import { LINE_SEARCH, pinnedSha256, stampOf, VERSIONS } from '../../../src/server/shared/config/index.js';

// The geometry, tile and image work is replaced by stand-ins: this file is about where files go and what the index says.
vi.mock('../../../src/server/entities/census-block/index.js', async (orig) => ({
  ...(await orig<typeof import('../../../src/server/entities/census-block/index.js')>()),
  loadStateBlocks: vi.fn(async () => [{ geoid: '500010201001000', pop: 1, point: [-72, 44], rings: [] }]),
  loadBlockPolygons: vi.fn(async () => new Map()),
}));
vi.mock('../../../src/server/features/publish/boundary.js', async (orig) => ({
  ...(await orig<typeof import('../../../src/server/features/publish/boundary.js')>()),
  loadStates: vi.fn(async () => []),
  loadLand: vi.fn(async () => []),
  loadCountyNames: vi.fn(async () => new Map([['50001', 'Addison County']])),
  loadEnacted: vi.fn(async (_cache: string, chamber: string, state?: { fips: string }) => ({
    source: chamber === 'federal-house' ? 'cb_2025_us_cd119_500k' : 'cb_2025_50_sldu_500k',
    features: Array.from({ length: 16 }, (_, i) => ({ record: { stateFp: state?.fips ?? '50', label: `District ${i + 1}`, code: String(i + 1).padStart(3, '0') }, geometry: {} })),
  })),
}));
vi.mock('../../../src/server/features/publish/water.js', () => ({
  mergeLand: vi.fn(async () => ''),
  buildWater: vi.fn(async () => ({ features: [] })),
  countLandParts: vi.fn(async (_d: string, _l: string, seats: number) => ({ parts: Array.from({ length: seats }, () => 1), clamped: 0, outside: 0 })),
}));
vi.mock('../../../src/server/features/publish/arcs.js', () => ({ districtArcs: vi.fn(async () => []) }));
vi.mock('../../../src/server/features/publish/tiles.js', () => ({
  buildDetailTiles: vi.fn(() => new Uint8Array([1])),
  districtsAtDeepTile: vi.fn(async (_t: unknown, _l: string, points: unknown[]) => points.map(() => 1)),
  deepSamplePoint: vi.fn((_rings: unknown, point: [number, number]) => point),
}));
vi.mock('../../../src/server/features/publish/border-blocks.js', () => ({ buildStateBorderBlocks: vi.fn(async () => new Uint8Array([2])) }));
vi.mock('../../../src/server/features/publish/og.js', () => ({ loadOgFonts: vi.fn(async () => []), ogSvg: vi.fn(() => ''), renderOgPng: vi.fn(() => new Uint8Array([3])), OG_PALETTE: [] }));
vi.mock('../../../src/server/features/publish/topo.js', async (orig) => ({
  ...(await orig<typeof import('../../../src/server/features/publish/topo.js')>()),
  toTopology: vi.fn(async () => '{"topology":true}'),
}));

const { buildIndex, publishData, publishedSummaries, summarize, PlanMetricsSchema } = await import('../../../src/server/features/publish/index.js');
const { parsePublishConfig } = await import('../../../src/server/shared/config/index.js');
const { writeSharePages } = await import('../../../build/share-pages.js');

const sha = (text: string): string => createHash('sha256').update(text).digest('hex');
const GEOID = '500010201001000';
const CSV = `GEOID20,district\n${GEOID},1\n`;

const metrics = (abbr: string, seats: number) => ({
  state: abbr, lineSearch: LINE_SEARCH, nodeVersion: 'v24.0.0', engine: VERSIONS.engine, bridges: 0,
  inputSha256: pinnedSha256(blocksFileName(stateByAbbr(abbr)!)), seats, population: 10, ideal: 5,
  districts: Array.from({ length: seats }, (_, i) => ({ district: i + 1, pop: 5, dev: 0, devPct: 0, contiguous: true })),
  rangePersons: 1, rangePct: 0.1, allContiguous: true, assignmentSha256: sha(CSV),
  cuts: 1, candidateRangesPerCut: [1], candidateRangesEvaluated: 1, strayBlocksMoved: 0, strayPopMoved: 0, recounts: 0, recountsMaxPerCut: 0,
  balanceMoves: 0, peopleMovedByBalancing: 0, rangeBeforeBalancing: 1, rangeAfterBalancing: 1, runtimeMs: 1, countiesSplit: 0, countiesTotal: 1, blocks: 1,
});

let root: string;
const put = (path: string, body: string): void => {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, body);
};
/** A drawn plan pair in the output directory, as the explore command leaves it. */
const plan = (dir: string, seats: number): void => {
  for (const sub of ['', 'before-balancing']) {
    put(join(dir, sub, 'metrics.json'), JSON.stringify(metrics('VT', seats)));
    put(join(dir, sub, 'assignment.csv'), CSV);
    put(join(dir, sub, 'districts.geojson'), JSON.stringify({ features: [] }));
  }
  put(join(dir, 'cuts.geojson'), JSON.stringify({ features: [] }));
  put(join(dir, 'balance.json'), JSON.stringify({ before: Array.from({ length: seats }, () => 1), moves: [] }));
  put(join(dir, 'bridges.json'), JSON.stringify({ links: [] }));
};
const filesIn = (dir: string): Record<string, string> =>
  Object.fromEntries(readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => [e.name, sha(readFileSync(join(dir, e.name), 'utf8'))]));

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'publish-chamber-'));
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

describe('publishing one chamber', () => {
  const run = (out: string, pub: string, ...args: string[]) =>
    publishData(parsePublishConfig(['--out-dir', out, '--public-dir', pub, ...args]), { planStale: async () => undefined });

  it('writes only under the chamber folder and leaves the state folder files byte-identical', async () => {
    const out = join(root, 'out');
    const pub = join(root, 'public');
    plan(join(out, 'VT'), 1);
    plan(join(out, 'VT', 'state-senate'), 16);
    await run(out, pub, '--states', 'VT');
    const federal = filesIn(join(pub, 'VT'));
    expect(Object.keys(federal)).toContain('stats.json');

    await run(out, pub, '--states', 'VT', '--chamber', 'state-senate');
    expect(filesIn(join(pub, 'VT'))).toEqual(federal);
    expect(Object.keys(filesIn(join(pub, 'VT', 'state-senate'))).sort()).toEqual(
      ['balance.json', 'before.topo.json', 'blocks.json', 'blocks.pmtiles', 'bridges.json', 'cuts.json', 'detail.pmtiles', 'districts.topo.json', 'enacted.topo.json', 'og.png', 'stats.json', 'water.topo.json'],
    );
    const stats = JSON.parse(readFileSync(join(pub, 'VT', 'state-senate', 'stats.json'), 'utf8')) as { enactedSource: string };
    expect(stats.enactedSource).toBe('cb_2025_50_sldu_500k');
    expect(existsSync(join(pub, 'VT', 'state-house'))).toBe(false);

    const index = JSON.parse(readFileSync(join(pub, 'index.json'), 'utf8')) as { states: { abbr: string; hasData: boolean; chambers: Record<string, { seats: number; hasData: boolean; summary?: object }> }[] };
    const vt = index.states.find((s) => s.abbr === 'VT')!;
    expect(vt.hasData).toBe(true);
    expect(vt.chambers['state-senate']).toMatchObject({ seats: 16, hasData: true });
    expect(vt.chambers['state-senate']!.summary).toBeDefined();
    expect(vt.chambers['state-house']).toEqual({ seats: 109, hasData: false });
    expect(index.states.find((s) => s.abbr === 'NE')!.chambers['state-house']).toEqual({ seats: 0, hasData: false });
  });

  it('reads the seats a published chamber was drawn with from its stats.json', async () => {
    const out = join(root, 'out');
    const pub = join(root, 'public');
    plan(join(out, 'VT', 'state-senate'), 16);
    await run(out, pub, '--states', 'VT', '--chamber', 'state-senate');
    const { publishedChamberData } = await import('../../../src/server/features/publish/publish.js');
    const data = await publishedChamberData(pub, [stateByAbbr('VT')!], 'state-senate');
    expect(data.seats.get('VT')).toBe(16);
    expect(data.summaries.has('VT')).toBe(true);
  });

  it("keeps every run's states in the index when two chambers publish at the same time", async () => {
    const out = join(root, 'out');
    const pub = join(root, 'public');
    plan(join(out, 'VT'), 1);
    plan(join(out, 'VT', 'state-senate'), 16);
    plan(join(out, 'VT', 'state-house'), 109);
    await Promise.all([
      run(out, pub, '--states', 'VT'),
      run(out, pub, '--states', 'VT', '--chamber', 'state-senate'),
      run(out, pub, '--states', 'VT', '--chamber', 'state-house'),
    ]);
    const index = JSON.parse(readFileSync(join(pub, 'index.json'), 'utf8')) as { states: { abbr: string; hasData: boolean; chambers: Record<string, { hasData: boolean }> }[] };
    const vt = index.states.find((s) => s.abbr === 'VT')!;
    expect([vt.hasData, vt.chambers['state-house']!.hasData, vt.chambers['state-senate']!.hasData]).toEqual([true, true, true]);
    expect(existsSync(join(pub, '.publish.lock'))).toBe(false);
    expect(readdirSync(pub).filter((n) => n.endsWith('.part'))).toEqual([]);
  });

  it('skips a state with no such chamber, also when it is named, without an error', async () => {
    const out = join(root, 'out');
    const pub = join(root, 'public');
    await run(out, pub, '--states', 'NE', '--chamber', 'state-house');
    expect(existsSync(join(pub, 'NE'))).toBe(false);
    const index = JSON.parse(readFileSync(join(pub, 'index.json'), 'utf8')) as { states: { abbr: string; chambers: Record<string, unknown> }[] };
    expect(index.states.find((s) => s.abbr === 'NE')!.chambers['state-house']).toEqual({ seats: 0, hasData: false });
  });
});

describe('index chambers', () => {
  it('lists a published chamber with the seats of its map, an undrawn one with the Census count', async () => {
    const withSummary = new Map([['RI', summarize(PlanMetricsSchema.parse({
      state: 'RI', lineSearch: 'exact', nodeVersion: 'v24.12.0', inputSha256: 'a', seats: 74, population: 10, ideal: 5,
      districts: [{ district: 1, pop: 5, dev: 0, devPct: 0, contiguous: true }], rangePersons: 1, rangePct: 0.1, allContiguous: true, assignmentSha256: 'b',
    }), stampOf(VERSIONS))]]);
    const index = buildIndex(STATES, new Map(), { 'state-house': withSummary, 'state-senate': new Map() }, { 'state-house': new Map([['RI', 74]]) });
    const ri = index.states.find((s) => s.abbr === 'RI')!.chambers!;
    expect(seatsFor(stateByAbbr('RI')!, 'state-house')).toBe(75);
    expect(ri['state-house']).toMatchObject({ seats: 74, hasData: true });
    expect(ri['state-senate']).toEqual({ seats: seatsFor(stateByAbbr('RI')!, 'state-senate'), hasData: false });
  });

  const summary = summarize(PlanMetricsSchema.parse({
    state: 'RI', lineSearch: 'exact', nodeVersion: 'v24.12.0', inputSha256: 'a', seats: 2, population: 10, ideal: 5,
    districts: [{ district: 1, pop: 5, dev: 0, devPct: 0, contiguous: true }], rangePersons: 1, rangePct: 0.1, allContiguous: true, assignmentSha256: 'b',
  }), stampOf(VERSIONS));
  const empty = new Map();

  it('lists both chambers of every state, a chamber the state lacks with zero seats', () => {
    const index = buildIndex(STATES, new Map(), { 'state-house': empty, 'state-senate': empty });
    const ne = index.states.find((s) => s.abbr === 'NE')!;
    expect(ne.chambers).toEqual({ 'state-house': { seats: 0, hasData: false }, 'state-senate': { seats: 49, hasData: false } });
    expect(index.states.every((s) => s.chambers !== undefined)).toBe(true);
  });

  it('keeps the federal fields the same with and without chambers', () => {
    const summaries = new Map([['RI', summary]]);
    const plain = buildIndex(STATES, summaries);
    const withChambers = buildIndex(STATES, summaries, { 'state-house': new Map([['RI', summary]]), 'state-senate': empty });
    expect(plain.states.some((s) => 'chambers' in s)).toBe(false);
    expect(withChambers.states.map(({ chambers: _c, ...federal }) => federal)).toEqual(plain.states);
    expect(withChambers.states.find((s) => s.abbr === 'RI')!.chambers!['state-house']).toEqual({ seats: 75, hasData: true, summary });
  });
});

describe('share pages for chambers', () => {
  it('writes /ST/house/ and /ST/senate/ only for a chamber with data', () => {
    const pub = join(root, 'public');
    const dist = join(root, 'dist');
    put(join(pub, 'data', 'VT', 'state-senate', 'og.png'), 'x');
    put(join(pub, 'data', 'index.json'), JSON.stringify({ states: [
      { abbr: 'VT', name: 'Vermont', seats: 1, hasData: true, chambers: { 'state-house': { seats: 109, hasData: false }, 'state-senate': { seats: 16, hasData: true } } },
      { abbr: 'NE', name: 'Nebraska', seats: 3, hasData: true, chambers: { 'state-house': { seats: 0, hasData: false }, 'state-senate': { seats: 49, hasData: false } } },
    ] }));
    expect(writeSharePages(pub, dist)).toEqual(['VT', 'VT/senate', 'NE']);
    const html = readFileSync(join(dist, 'VT', 'senate', 'index.html'), 'utf8');
    expect(html).toContain('content="0; url=../../#/VT/senate"');
    expect(html).toContain('/data/VT/state-senate/og.png');
    expect(html).toContain('<link rel="canonical" href="https://fairmaps.melson.us/VT/senate/" />');
    expect(html).toContain('Vermont State Senate');
    expect(html).not.toContain('—');
    expect(existsSync(join(dist, 'VT', 'house'))).toBe(false);
    expect(existsSync(join(dist, 'NE', 'senate'))).toBe(false);
  });
});
