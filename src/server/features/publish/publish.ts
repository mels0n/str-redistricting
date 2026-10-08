import type { Feature } from 'geojson';
import { z } from 'zod';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';
import { loadBlockPolygons, loadStateBlocks, type Block } from '../../entities/census-block/index.js';
import { STATES, type StateInfo } from '../../shared/apportionment/index.js';
import { formatVersions, stampOf, VERSIONS, type PublishConfig, type VersionStamp } from '../../shared/config/index.js';
import { DataError } from '../../shared/errors/index.js';
import { crossesAntimeridian, unwrapCoordinates, unwrapFeatures, unwrapLon } from './antimeridian.js';
import { districtArcs } from './arcs.js';
import { BlocksFileSchema, checkBlocks, checkFingerprints, encodeBlocks, lookup, type BlocksFile } from './blocks.js';
import { loadCountyNames, loadEnacted, loadLand, loadStates, type EnactedFile } from './boundary.js';
import { BalanceLogSchema, buildBalance, ProcessNumbersSchema } from './balance.js';
import { countiesByDistrict } from './counties.js';
import { buildStateBorderBlocks } from './border-blocks.js';
import { buildEnactedTopology } from './enacted.js';
import { buildCuts } from './cuts.js';
import { checkPublishGate } from './gate.js';
import { loadOgFonts, OG_PALETTE, ogSvg, renderOgPng } from './og.js';
import { ogCredit } from './og-credit.js';
import { buildStats, planStats } from './stats.js';
import { buildIndex, PlanMetricsSchema, PublishedMetricsSchema, PublishedStampSchema, summarize, type PlanMetrics, type StateSummary } from './summary.js';
import { buildDetailTiles, districtsAtDeepTile } from './tiles.js';
import { districtBudget, toTopology } from './topo.js';
import { buildPublishedBridges, districtsByGeoid } from './bridges.js';
import { buildWater, countLandParts, mergeLand, type PopulatedPoint } from './water.js';

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

const PublishedStatsSchema = z.object({ versions: PublishedStampSchema.optional(), finished: z.object({ metrics: PublishedMetricsSchema }) });

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
    summaries.set(s.abbr, summarize(parsed.data.finished.metrics, parsed.data.versions));
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
  const budget = districtBudget(state.seats);

  const [official, before] = [await readMetrics(src), await readMetrics(srcBefore)];
  const versions = stampOf(VERSIONS);
  // Before any work or write: a map may only change when the engine major or the input revision moves.
  checkPublishGate(await readPublishedState(join(dest, 'stats.json')), { versions, sha: official.assignmentSha256 }, cfg.baseline, state.abbr);
  const [officialCsv, beforeCsv] = [await readFile(join(src, 'assignment.csv'), 'utf8'), await readFile(join(srcBefore, 'assignment.csv'), 'utf8')];
  // Display only: separate land pieces with people on them per district, from the same district files the water mask uses.
  const allBlocks = await loadStateBlocks(state, cfg.cacheDir);
  const populatedUnder = (csv: string, label: string): PopulatedPoint[] => {
    const byGeoid = districtsByGeoid(csv, label);
    const out: PopulatedPoint[] = [];
    for (const b of allBlocks) {
      const district = byGeoid.get(b.geoid);
      if (b.pop > 0 && district !== undefined) out.push({ district, point: [b.point[0], b.point[1]] });
    }
    return out;
  };
  const finishedLand = await countLandParts(await readFile(join(src, 'districts.geojson'), 'utf8'), shared.land, state.seats, populatedUnder(officialCsv, `${state.abbr} assignment.csv`));
  const beforeLand = await countLandParts(await readFile(join(srcBefore, 'districts.geojson'), 'utf8'), shared.land, state.seats, populatedUnder(beforeCsv, `${state.abbr} before-balancing/assignment.csv`));
  const finishedParts = finishedLand.parts;
  const beforeParts = beforeLand.parts;
  if (finishedLand.clamped + beforeLand.clamped + finishedLand.outside + beforeLand.outside > 0) {
    console.log(`  ${state.abbr}: landParts clamped to 1 for ${finishedLand.clamped} finished and ${beforeLand.clamped} before-balancing districts; populated points outside the clipped land: ${finishedLand.outside} finished, ${beforeLand.outside} before-balancing`);
  }
  const stats = buildStats(
    planStats(official, countiesByDistrict(officialCsv, state.seats, shared.countyNames), finishedParts),
    planStats(before, countiesByDistrict(beforeCsv, state.seats, shared.countyNames), beforeParts),
    shared.enacted.source,
    versions,
  );

  // The display copies of a state that crosses the antimeridian are drawn in one continuous frame; the generator's files are not touched.
  const wrapped = crossesAntimeridian(state.abbr);
  const display = <T extends { readonly geometry: unknown }>(fs: readonly T[]): T[] => (wrapped ? unwrapFeatures(fs) : [...fs]);
  const districts = (await readJson(join(src, 'districts.geojson'))) as Parameters<typeof toTopology>[0];
  const outputs: [string, string | Uint8Array][] = [];
  const districtsTopo = await toTopology({ features: display(districts.features) }, 'districts', budget);
  outputs.push(['districts.topo.json', districtsTopo]);
  const credit = ogCredit({ abbr: state.abbr, name: state.name, versions, assignmentSha256: official.assignmentSha256 });
  outputs.push(['og.png', renderOgPng(ogSvg({ name: state.name, abbr: state.abbr, seats: state.seats, topo: districtsTopo, credit, palette: OG_PALETTE }), await loadOgFonts())]);
  const beforeDistricts = (await readJson(join(srcBefore, 'districts.geojson'))) as Parameters<typeof toTopology>[0];
  outputs.push(['before.topo.json', await toTopology({ features: display(beforeDistricts.features) }, 'districts', budget)]);

  // Water is display only: the area the districts cover less the shoreline-clipped land. It gets half the district vertex budget.
  const water = await buildWater(await readFile(join(src, 'districts.geojson'), 'utf8'), shared.land);
  outputs.push(['water.topo.json', await toTopology({ features: display(water.features) }, 'water', Math.round(budget / 2))]);

  const bridgeCount = official.bridges;
  if (bridgeCount === undefined) throw new DataError(`${src}/metrics.json: bridges is missing; re-run explore for ${state.abbr}`);
  outputs.push(['bridges.json', JSON.stringify(await buildPublishedBridges(src, state.abbr, bridgeCount, officialCsv, beforeCsv))]);

  outputs.push(['enacted.topo.json', await buildEnactedTopology(state, shared.enacted)]);

  const cuts = buildCuts(await readJson(join(src, 'cuts.geojson')));
  outputs.push(['cuts.json', JSON.stringify(wrapped ? cuts.map((c) => ({ ...c, lines: unwrapCoordinates(c.lines) })) : cuts)]);
  const log = BalanceLogSchema.safeParse(await readJson(join(src, 'balance.json')));
  if (!log.success) throw new DataError(`${src}/balance.json: ${log.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
  const polygons = await loadBlockPolygons(state, cfg.cacheDir, new Set(log.data.moves.map((m) => m.geoid)));
  const balance = buildBalance(state.seats, log.data, polygons);
  const blocks = wrapped ? Object.fromEntries(Object.entries(balance.blocks).map(([g, polys]) => [g, unwrapCoordinates(polys)])) : balance.blocks;
  outputs.push(['balance.json', JSON.stringify({ ...balance, blocks })]);

  // Block lookup and detail tiles, from the same display copies as the topologies above (unsimplified).
  const fingerprints = { finished: official.assignmentSha256, before: before.assignmentSha256 };
  const blocksFile = encodeBlocks(state.fips, state.seats, officialCsv, beforeCsv, fingerprints);
  checkBlocks(blocksFile, officialCsv, beforeCsv, { state: state.fips, seats: state.seats, fingerprints });
  const blocksJson = JSON.stringify(blocksFile);

  const finishedFeatures = display(districts.features) as Feature[];
  const beforeFeatures = display(beforeDistricts.features) as Feature[];
  const tiles = buildDetailTiles({
    finished: finishedFeatures,
    before: beforeFeatures,
    'finished-arcs': (await districtArcs({ features: finishedFeatures as never })) as Feature[],
    'before-arcs': (await districtArcs({ features: beforeFeatures as never })) as Feature[],
    water: display(water.features) as unknown as Feature[],
  }, fingerprints);
  await verifyTiles(state, allBlocks, tiles, blocksFile, new Set(log.data.moves.map((m) => m.geoid)), wrapped);
  const borderTiles = await buildStateBorderBlocks(state, cfg.cacheDir, allBlocks, districtsByGeoid(officialCsv, `${state.abbr} assignment.csv`), districtsByGeoid(beforeCsv, `${state.abbr} before-balancing/assignment.csv`), fingerprints);
  outputs.push(['blocks.json', blocksJson], ['detail.pmtiles', tiles]);
  if (borderTiles) outputs.push(['blocks.pmtiles', borderTiles]);

  // Every output is built and checked above; only now does anything in the public directory change, stats.json last.
  await mkdir(dest, { recursive: true });
  // A one-district state has no blocks.pmtiles; a file left by an earlier run would be stale.
  if (!borderTiles) await rm(join(dest, 'blocks.pmtiles'), { force: true });
  for (const [name, body] of outputs) await write(join(dest, name), body);
  const rawBytes = Buffer.byteLength(blocksJson);
  console.log(`  ${state.abbr}: detail.pmtiles ${tiles.byteLength} B, blocks.pmtiles ${borderTiles ? `${borderTiles.byteLength} B` : 'none (one district)'}, blocks.json ${rawBytes} B (${gzipSync(blocksJson).byteLength} B gzip)`);

  await write(join(dest, 'stats.json'), JSON.stringify(stats));
}

/** The stamp and fingerprint of a state already in the public directory, or null when nothing is published. */
async function readPublishedState(statsPath: string): Promise<{ versions?: VersionStamp; sha: string } | null> {
  if (!existsSync(statsPath)) return null;
  const parsed = PublishedStatsSchema.safeParse(await readJson(statsPath));
  if (!parsed.success) throw new DataError(`${statsPath}: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
  return { ...(parsed.data.versions ? { versions: parsed.data.versions } : {}), sha: parsed.data.finished.metrics.assignmentSha256 };
}

/** Every 1-in-N block (about TILE_CHECK_SAMPLE) plus every moved block must land in the district the CSVs give, under both plans. */
async function verifyTiles(state: StateInfo, all: readonly Block[], tiles: Uint8Array, file: BlocksFile, moved: ReadonlySet<string>, wrapped: boolean): Promise<void> {
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

const EnactedStatsSchema = z.looseObject({ enactedSource: z.string(), versions: PublishedStampSchema.optional() });

/**
 * Rebuild only what depends on the enacted-districts file, from the files already published: each state's
 * `enacted.topo.json` and the `enactedSource` in its `stats.json`. It needs no generated plans, and writes a file
 * only when its bytes change, so a run against the file the data was built from touches nothing. The index and
 * every other file are left alone: none of them depends on the enacted districts.
 */
export async function publishEnactedOnly(cfg: PublishConfig): Promise<void> {
  const published = STATES.filter((s) => existsSync(join(cfg.publicDir, s.abbr, 'stats.json')));
  const selected = cfg.states === undefined ? published : cfg.states;
  for (const s of selected) {
    if (!published.some((p) => p.abbr === s.abbr)) throw new DataError(`${s.abbr}: nothing published in ${cfg.publicDir}, so there is no data to update`);
  }
  const stamp = stampOf(VERSIONS);
  const enacted = await loadEnacted(cfg.cacheDir);
  console.log(`enacted source: ${enacted.source}`);
  // Everything is built and checked first, so a state that fails leaves the public directory untouched.
  const built: { state: StateInfo; dir: string; statsPath: string; stats: z.infer<typeof EnactedStatsSchema>; topo: string }[] = [];
  for (const s of selected) {
    const dir = join(cfg.publicDir, s.abbr);
    const statsPath = join(dir, 'stats.json');
    const stats = EnactedStatsSchema.safeParse(await readJson(statsPath));
    if (!stats.success) throw new DataError(`${statsPath}: ${stats.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
    built.push({ state: s, dir, statsPath, stats: stats.data, topo: await buildEnactedTopology(s, enacted) });
  }
  for (const b of built) {
    const changed = [await writeIfChanged(join(b.dir, 'enacted.topo.json'), b.topo)];
    // Parsing keeps key order, and the file is written with JSON.stringify, so only these values can change. The
    // assignments are untouched, so no gate: a stamped state takes the current maps release and input revision.
    const stamped = b.stats.versions !== undefined;
    changed.push(await writeIfChanged(b.statsPath, JSON.stringify({ ...b.stats, enactedSource: enacted.source, ...(stamped ? { versions: stamp } : {}) })));
    console.log(`  ${b.state.abbr}: ${changed.some(Boolean) ? 'updated' : 'unchanged'}`);
  }
  const restamped = built.filter((b) => b.stats.versions !== undefined);
  if (restamped.length > 0) {
    await restampIndex(join(cfg.publicDir, 'index.json'), new Set(restamped.map((b) => b.state.abbr)), stamp);
    await writeIfChanged(join(cfg.publicDir, 'versions.json'), formatVersions(VERSIONS));
  }
}

/** Replace `summary.versions` in the index for the given states; everything else in the file is kept as parsed. */
async function restampIndex(path: string, states: ReadonlySet<string>, stamp: VersionStamp): Promise<void> {
  if (!existsSync(path)) return;
  const IndexShape = z.looseObject({ states: z.array(z.looseObject({ abbr: z.string(), summary: z.looseObject({}).optional() })) });
  const parsed = IndexShape.safeParse(await readJson(path));
  if (!parsed.success) throw new DataError(`${path}: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
  const next = { ...parsed.data, states: parsed.data.states.map((e) => (e.summary !== undefined && states.has(e.abbr) ? { ...e, summary: { ...e.summary, versions: stamp } } : e)) };
  await writeIfChanged(path, JSON.stringify(next));
}

async function writeIfChanged(path: string, body: string): Promise<boolean> {
  if (existsSync(path) && (await readFile(path, 'utf8')) === body) return false;
  await write(path, body);
  return true;
}

const PlanShaSchema = z.looseObject({ metrics: z.looseObject({ assignmentSha256: z.string() }) });
const ShaStatsSchema = z.looseObject({ finished: PlanShaSchema, beforeBalancing: PlanShaSchema });

/**
 * Rebuild only each published state's `blocks.pmtiles`. The districts of every block come from the state's published
 * `blocks.json` (the same data the detail tiles were cut from) and the shapes from the cached TIGER blocks, so the file
 * always belongs to the data it sits next to and nothing is needed from the output directory. Every other file is left alone.
 */
export async function publishBlocksOnly(cfg: PublishConfig): Promise<void> {
  const published = STATES.filter((s) => existsSync(join(cfg.publicDir, s.abbr, 'stats.json')));
  const selected = cfg.states === undefined ? published : cfg.states;
  for (const s of selected) {
    if (!published.some((p) => p.abbr === s.abbr)) throw new DataError(`${s.abbr}: nothing published in ${cfg.publicDir}, so there is no data to update`);
  }
  for (const s of selected) {
    const path = join(cfg.publicDir, s.abbr, 'blocks.json');
    const parsed = BlocksFileSchema.safeParse(await readJson(path));
    if (!parsed.success) throw new DataError(`${path}: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
    const file: BlocksFile = parsed.data;
    if (file.state !== s.fips || file.seats !== s.seats) throw new DataError(`${path}: is not the file of ${s.abbr}`);
    checkFingerprints(file.fingerprints);
    for (const [tract, v] of Object.entries(file.tracts)) {
      const districts = [v[0], v[1], ...Object.values(v[2] ?? {}).flat()];
      if (districts.some((d) => d > file.seats)) throw new DataError(`${path}: tract ${tract} names a district above ${file.seats}`);
    }
    // The file must belong to the plans published beside it: its fingerprints are those recorded in stats.json.
    const statsPath = join(cfg.publicDir, s.abbr, 'stats.json');
    const stats = ShaStatsSchema.safeParse(await readJson(statsPath));
    if (!stats.success) throw new DataError(`${statsPath}: ${stats.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
    if (stats.data.finished.metrics.assignmentSha256 !== file.fingerprints.finished || stats.data.beforeBalancing.metrics.assignmentSha256 !== file.fingerprints.before) {
      throw new DataError(`${path}: its plan fingerprints differ from those in ${statsPath}`);
    }
    const allBlocks = await loadStateBlocks(s, cfg.cacheDir);
    const finished = new Map<string, number>();
    const before = new Map<string, number>();
    for (const b of allBlocks) {
      const got = lookup(file, b.geoid);
      if (!got) throw new DataError(`${s.abbr}: block ${b.geoid} is not in ${path}`);
      finished.set(b.geoid, got[0]);
      before.set(b.geoid, got[1]);
    }
    const bytes = await buildStateBorderBlocks(s, cfg.cacheDir, allBlocks, finished, before, file.fingerprints);
    const out = join(cfg.publicDir, s.abbr, 'blocks.pmtiles');
    if (bytes) await write(out, bytes);
    else await rm(out, { force: true });
    console.log(`  ${s.abbr}: blocks.pmtiles ${bytes ? `${bytes.byteLength} B` : 'none (one district)'}`);
  }
}

/** Write the web-ready data for the selected states (default: every state with a generated plan), plus the national files and the index. */
export async function publishData(cfg: PublishConfig): Promise<void> {
  if (cfg.enactedOnly) return publishEnactedOnly(cfg);
  if (cfg.blocksOnly) return publishBlocksOnly(cfg);
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
  await write(join(cfg.publicDir, 'versions.json'), formatVersions(VERSIONS));
}
