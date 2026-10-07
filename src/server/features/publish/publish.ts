import type { Feature } from 'geojson';
import { z } from 'zod';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';
import { loadBlockPolygons, loadStateBlocks } from '../../entities/census-block/index.js';
import { STATES, type StateInfo } from '../../shared/apportionment/index.js';
import type { PublishConfig } from '../../shared/config/index.js';
import { DataError } from '../../shared/errors/index.js';
import { crossesAntimeridian, unwrapCoordinates, unwrapFeatures, unwrapLon } from './antimeridian.js';
import { districtArcs } from './arcs.js';
import { checkBlocks, encodeBlocks, lookup, type BlocksFile } from './blocks.js';
import { loadCountyNames, loadEnacted, loadLand, loadStates, type EnactedFile } from './boundary.js';
import { BalanceLogSchema, buildBalance, ProcessNumbersSchema } from './balance.js';
import { countiesByDistrict } from './counties.js';
import { buildCuts } from './cuts.js';
import { buildStats, planStats } from './stats.js';
import { buildIndex, PlanMetricsSchema, PublishedMetricsSchema, summarize, type PlanMetrics, type StateSummary } from './summary.js';
import { buildDetailTiles, districtsAtDeepTile } from './tiles.js';
import { districtBudget, toTopology } from './topo.js';
import { buildWater, mergeLand } from './water.js';

const NATIONAL_BUDGET = 12000;
/** About this many blocks per state are checked against the detail tiles, plus every block the balancer moved. */
const TILE_CHECK_SAMPLE = 2000;
const MAX_MISSES_LISTED = 5;
const POINTS_PER_BATCH = 500;

const readJson = async (path: string): Promise<unknown> => JSON.parse(await readFile(path, 'utf8'));
const write = (path: string, body: string | Uint8Array) => writeFile(path, body);

async function readMetrics(dir: string): Promise<PlanMetrics> {
  const parsed = PlanMetricsSchema.safeParse(await readJson(join(dir, 'metrics.json')));
  if (!parsed.success) throw new DataError(`${dir}/metrics.json: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
  const extras = ProcessNumbersSchema.safeParse(parsed.data);
  if (!extras.success) throw new DataError(`${dir}/metrics.json: ${extras.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
  return parsed.data;
}


/** States whose generated plan is present in the output directory. */
export const statesWithData = (outDir: string): StateInfo[] => STATES.filter((s) => existsSync(join(outDir, s.abbr, 'metrics.json')));

const PublishedStatsSchema = z.object({ finished: z.object({ metrics: PublishedMetricsSchema }) });

/**
 * Summaries of the states whose files are actually in the public directory. A state counts as published
 * when its stats.json is there (it is the last file written for a state), so the index never lists a state without files.
 */
export async function publishedSummaries(publicDir: string, states: readonly StateInfo[] = STATES): Promise<Map<string, StateSummary>> {
  const summaries = new Map<string, StateSummary>();
  for (const s of states) {
    const path = join(publicDir, s.abbr, 'stats.json');
    if (!existsSync(path)) continue;
    const parsed = PublishedStatsSchema.safeParse(await readJson(path));
    if (!parsed.success) throw new DataError(`${path}: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
    summaries.set(s.abbr, summarize(parsed.data.finished.metrics));
  }
  return summaries;
}

interface Shared {
  readonly countyNames: ReadonlyMap<string, string>;
  readonly enacted: EnactedFile;
  /** All states' land merged into one layer (GeoJSON text), for the water masks. */
  readonly land: string;
}

async function publishState(state: StateInfo, cfg: PublishConfig, shared: Shared): Promise<void> {
  const src = join(cfg.outDir, state.abbr);
  const srcBefore = join(src, 'before-balancing');
  const dest = join(cfg.publicDir, state.abbr);
  await mkdir(dest, { recursive: true });
  const budget = districtBudget(state.seats);

  const [official, before] = [await readMetrics(src), await readMetrics(srcBefore)];
  const [officialCsv, beforeCsv] = [await readFile(join(src, 'assignment.csv'), 'utf8'), await readFile(join(srcBefore, 'assignment.csv'), 'utf8')];
  const stats = buildStats(
    planStats(official, countiesByDistrict(officialCsv, state.seats, shared.countyNames)),
    planStats(before, countiesByDistrict(beforeCsv, state.seats, shared.countyNames)),
    shared.enacted.source,
  );

  // The display copies of a state that crosses the antimeridian are drawn in one continuous frame; the generator's files are not touched.
  const wrapped = crossesAntimeridian(state.abbr);
  const display = <T extends { readonly geometry: unknown }>(fs: readonly T[]): T[] => (wrapped ? unwrapFeatures(fs) : [...fs]);
  const districts = (await readJson(join(src, 'districts.geojson'))) as Parameters<typeof toTopology>[0];
  await write(join(dest, 'districts.topo.json'), await toTopology({ features: display(districts.features) }, 'districts', budget));
  const beforeDistricts = (await readJson(join(srcBefore, 'districts.geojson'))) as Parameters<typeof toTopology>[0];
  await write(join(dest, 'before.topo.json'), await toTopology({ features: display(beforeDistricts.features) }, 'districts', budget));

  // Water is display only: the area the districts cover less the shoreline-clipped land. It gets half the district vertex budget.
  const water = await buildWater(await readFile(join(src, 'districts.geojson'), 'utf8'), shared.land);
  await write(join(dest, 'water.topo.json'), await toTopology({ features: display(water.features) }, 'water', Math.round(budget / 2)));

  const enacted = shared.enacted.features
    .filter((f) => f.record.stateFp === state.fips)
    .sort((a, b) => a.record.code.localeCompare(b.record.code))
    .map((f) => ({ type: 'Feature', properties: { label: f.record.label, code: f.record.code }, geometry: f.geometry as { coordinates?: unknown } }));
  if (enacted.length === 0) throw new DataError(`${state.abbr}: no enacted districts in ${shared.enacted.source}`);
  await write(join(dest, 'enacted.topo.json'), await toTopology({ features: display(enacted) }, 'enacted', budget));

  const cuts = buildCuts(await readJson(join(src, 'cuts.geojson')));
  await write(join(dest, 'cuts.json'), JSON.stringify(wrapped ? cuts.map((c) => ({ ...c, lines: unwrapCoordinates(c.lines) })) : cuts));
  const log = BalanceLogSchema.safeParse(await readJson(join(src, 'balance.json')));
  if (!log.success) throw new DataError(`${src}/balance.json: ${log.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
  const polygons = await loadBlockPolygons(state, cfg.cacheDir, new Set(log.data.moves.map((m) => m.geoid)));
  const balance = buildBalance(state.seats, log.data, polygons);
  const blocks = wrapped ? Object.fromEntries(Object.entries(balance.blocks).map(([g, polys]) => [g, unwrapCoordinates(polys)])) : balance.blocks;
  await write(join(dest, 'balance.json'), JSON.stringify({ ...balance, blocks }));

  // Block lookup and detail tiles, from the same display copies as the topologies above (unsimplified).
  const blocksFile = encodeBlocks(state.fips, state.seats, officialCsv, beforeCsv);
  checkBlocks(blocksFile, officialCsv, beforeCsv, { state: state.fips, seats: state.seats });
  const blocksJson = JSON.stringify(blocksFile);
  await write(join(dest, 'blocks.json'), blocksJson);

  const finishedFeatures = display(districts.features) as Feature[];
  const beforeFeatures = display(beforeDistricts.features) as Feature[];
  let tiles: Uint8Array | null = buildDetailTiles({
    finished: finishedFeatures,
    before: beforeFeatures,
    'finished-arcs': (await districtArcs({ features: finishedFeatures as never })) as Feature[],
    'before-arcs': (await districtArcs({ features: beforeFeatures as never })) as Feature[],
    water: display(water.features) as unknown as Feature[],
  });
  await verifyTiles(state, cfg, tiles, blocksFile, new Set(log.data.moves.map((m) => m.geoid)), wrapped);
  await write(join(dest, 'detail.pmtiles'), tiles);
  const rawBytes = Buffer.byteLength(blocksJson);
  console.log(`  ${state.abbr}: detail.pmtiles ${tiles.byteLength} B, blocks.json ${rawBytes} B (${gzipSync(blocksJson).byteLength} B gzip)`);
  tiles = null;

  await write(join(dest, 'stats.json'), JSON.stringify(stats));
}

/** Every 1-in-N block (about TILE_CHECK_SAMPLE) plus every moved block must land in the district the CSVs give, under both plans. */
async function verifyTiles(state: StateInfo, cfg: PublishConfig, tiles: Uint8Array, file: BlocksFile, moved: ReadonlySet<string>, wrapped: boolean): Promise<void> {
  const all = await loadStateBlocks(state, cfg.cacheDir);
  const stride = Math.max(1, Math.floor(all.length / TILE_CHECK_SAMPLE));
  const picked = all.filter((b, i) => i % stride === 0 || moved.has(b.geoid));
  const misses: string[] = [];
  for (let i = 0; i < picked.length; i += POINTS_PER_BATCH) {
    const batch = picked.slice(i, i + POINTS_PER_BATCH);
    const points = batch.map((b): [number, number] => (wrapped ? [unwrapLon(b.point[0]), b.point[1]] : [b.point[0], b.point[1]]));
    for (const [layer, which] of [['finished', 0], ['before', 1]] as const) {
      const got = await districtsAtDeepTile(tiles, layer, points);
      batch.forEach((b, j) => {
        const want = lookup(file, b.geoid)?.[which];
        if (got[j] !== want) misses.push(`${b.geoid} ${layer}: tile ${String(got[j])}, assignment ${String(want)}`);
      });
    }
  }
  if (misses.length > 0) {
    throw new DataError(`${state.abbr}: ${misses.length} of ${picked.length} sampled blocks disagree with the detail tiles; first ${MAX_MISSES_LISTED}: ${misses.slice(0, MAX_MISSES_LISTED).join('; ')}`);
  }
}

/** Write the web-ready data for the selected states (default: every state with a generated plan), plus the national files and the index. */
export async function publishData(cfg: PublishConfig): Promise<void> {
  const withData = statesWithData(cfg.outDir);
  const selected = cfg.states === undefined ? withData : withData.filter((s) => cfg.states!.some((x) => x.abbr === s.abbr));
  await mkdir(cfg.publicDir, { recursive: true });

  const outlines = (await loadStates(cfg.cacheDir)).filter((o) => STATES.some((s) => s.abbr === o.abbr));
  await write(
    join(cfg.publicDir, 'states.topo.json'),
    await toTopology({ features: outlines.map((o) => ({ type: 'Feature', properties: { abbr: o.abbr, name: o.name }, geometry: o.geometry as { coordinates?: unknown } })) }, 'states', NATIONAL_BUDGET),
  );

  const shared: Shared = { countyNames: await loadCountyNames(cfg.cacheDir), enacted: await loadEnacted(cfg.cacheDir), land: await mergeLand(await loadLand(cfg.cacheDir)) };
  for (const s of selected) {
    console.log(`publishing ${s.abbr}`);
    await publishState(s, cfg, shared);
  }

  // The index describes what is in the public directory, after this run's states are written.
  await write(join(cfg.publicDir, 'index.json'), JSON.stringify(buildIndex(STATES, await publishedSummaries(cfg.publicDir))));
}
