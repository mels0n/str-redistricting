import type { Feature } from 'geojson';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';
import { blocksFileName, loadBlockPolygons, loadStateBlocks, type Block } from '../../entities/census-block/index.js';
import { STATES, type StateInfo } from '../../shared/apportionment/index.js';
import { planDir, seatsFor, stateForChamber, type Chamber } from '../../shared/chamber/index.js';
import { LINE_SEARCH, formatVersions, pinnedSha256, stampOf, VERSIONS, VersionsSchema, type VersionStamp, type Versions } from '../../shared/config/index.js';
import type { PublishRunConfig } from '../../shared/config/publish-mode.js';
import { DataError } from '../../shared/errors/index.js';
import { crossesAntimeridian, unwrapCoordinates, unwrapFeatures, unwrapLon } from './antimeridian.js';
import { districtArcs } from './arcs.js';
import { BlocksFileSchema, checkBlocks, checkFingerprints, encodeBlocks, lookup, type BlocksFile } from './blocks.js';
import { loadCountyNames, loadEnacted, loadLand, loadStates, type EnactedFile } from './boundary.js';
import { BalanceLogSchema, borderOnlyMoves, buildBalance, ProcessNumbersSchema } from './balance.js';
import { countiesByDistrict } from './counties.js';
import { buildStateBorderBlocks } from './border-blocks.js';
import { buildEnactedTopology } from './enacted.js';
import { buildCuts } from './cuts.js';
import { checkPublishGate, staleStamps, type PublishedPlan } from './gate.js';
import { readJsonRetrying, withDirLock, writeAtomic } from './safe-write.js';
import { checkPlanProvenance } from './provenance.js';
import { stateBadgeFiles } from './badges.js';
import { loadOgFonts, OG_PALETTE, ogSvg, renderOgPng } from './og.js';
import { ogCredit } from './og-credit.js';
import { buildBeforeNeighbors } from './neighbors.js';
import { buildStats, planStats } from './stats.js';
import { buildIndex, STATE_CHAMBERS, PlanMetricsSchema, PublishedMetricsSchema, PublishedStampSchema, summarize, type PlanMetrics, type StateSummary } from './summary.js';
import { buildDetailTiles, deepSamplePoint, districtsAtDeepTile } from './tiles.js';
import { districtBudget, toTopology } from './topo.js';
import { buildPublishedBridges, districtsByGeoid } from './bridges.js';
import { buildWater, countLandParts, mergeLand, type PopulatedPoint } from './water.js';

const NATIONAL_BUDGET = 12000;
/** About this many blocks per state are checked against the detail tiles, plus every block the balancer moved. */
const TILE_CHECK_SAMPLE = 2000;
const MAX_MISSES_LISTED = 5;
const POINTS_PER_BATCH = 500;

// A file another run is replacing is read again once, and every write goes through a rename (see safe-write.ts).
const readJson = (path: string): Promise<unknown> => readJsonRetrying(async () => JSON.parse(await readFile(path, 'utf8')));
const write = (path: string, body: string | Uint8Array) => writeAtomic(path, body);

async function readMetrics(dir: string): Promise<PlanMetrics> {
  const parsed = PlanMetricsSchema.safeParse(await readJson(join(dir, 'metrics.json')));
  if (!parsed.success) throw new DataError(`${dir}/metrics.json: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
  const extras = ProcessNumbersSchema.safeParse(parsed.data);
  if (!extras.success) throw new DataError(`${dir}/metrics.json: ${extras.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
  return parsed.data;
}


/** States whose generated plan is present in the output directory. */
export const statesWithData = (outDir: string, chamber: Chamber = 'federal-house'): StateInfo[] =>
  STATES.filter((s) => existsSync(join(outDir, planDir(s.abbr, chamber), 'metrics.json')));

/** A chamber's name as the preview image and log lines say it. */
const CHAMBER_NAME: Record<Chamber, string> = { 'federal-house': 'Federal House', 'state-house': 'State House', 'state-senate': 'State Senate' };
/** The share-page segment of a state chamber (the viewer's link is /CO/house/). */
const CHAMBER_SEGMENT = { 'state-house': 'house', 'state-senate': 'senate' } as const;

/**
 * The states a chamber run covers, with that chamber's district count as their seats. A state with no such chamber (seats 0,
 * such as Nebraska's House) has nothing to draw or publish: it is skipped, with a note, never an error.
 */
function withChamberSeats(states: readonly StateInfo[], chamber: Chamber): StateInfo[] {
  if (chamber === 'federal-house') return [...states];
  const out: StateInfo[] = [];
  for (const s of states) {
    const mapped = stateForChamber(s, chamber);
    if (mapped.seats === 0) console.log(`${s.abbr}: has no ${CHAMBER_NAME[chamber]}, nothing to publish`);
    else out.push(mapped);
  }
  return out;
}

const PublishedStatsSchema = z.object({
  versions: PublishedStampSchema.optional(),
  finished: z.object({ metrics: PublishedMetricsSchema }),
  beforeBalancing: z.looseObject({ metrics: z.looseObject({ assignmentSha256: z.string() }) }).optional(),
});

/**
 * The part of a published stats.json the publish gate reads: the stamp and the fingerprints. Kept separate from the
 * full schema so data published under an older metrics layout can still be compared and replaced.
 */
const GateStatsSchema = z.looseObject({
  versions: PublishedStampSchema.optional(),
  finished: z.looseObject({ metrics: z.looseObject({ assignmentSha256: z.string(), inputSha256: z.string(), seats: z.number().int().optional() }) }),
  beforeBalancing: z.looseObject({ metrics: z.looseObject({ assignmentSha256: z.string() }) }).optional(),
});

/**
 * Read both plans of a state from the output directory and refuse any not drawn by the current engine major, from the
 * pinned census file, with the current line search. Nothing is published from a plan this refuses.
 */
async function readCheckedPlans(state: StateInfo, outDir: string, chamber: Chamber): Promise<{ finished: PlanMetrics; before: PlanMetrics }> {
  const dir = join(outDir, planDir(state.abbr, chamber));
  const expected = { engine: VERSIONS.engine, inputSha256: pinnedSha256(blocksFileName(state)), lineSearch: LINE_SEARCH };
  // The command named in a refusal re-draws this chamber, not the Federal House.
  const rerun = chamber === 'federal-house' ? state.abbr : `${state.abbr} --chamber ${chamber}`;
  const label = chamber === 'federal-house' ? state.abbr : `${state.abbr} ${chamber}`;
  const finished = await readMetrics(dir);
  checkPlanProvenance(finished, rerun, label, expected);
  const before = await readMetrics(join(dir, 'before-balancing'));
  checkPlanProvenance(before, rerun, `${label} before-balancing`, expected);
  return { finished, before };
}

/**
 * Summaries of the states whose files are actually in the public directory. A state counts as published
 * when its stats.json is there (it is the last file written for a state), so the index never lists a state without files.
 */
export async function publishedSummaries(publicDir: string, states: readonly StateInfo[] = STATES, chamber: Chamber = 'federal-house'): Promise<Map<string, StateSummary>> {
  return (await publishedChamberData(publicDir, states, chamber)).summaries;
}

/** The summaries of a chamber's published maps, and the district count each map was drawn with (absent from data published before it was recorded). */
export async function publishedChamberData(
  publicDir: string,
  states: readonly StateInfo[] = STATES,
  chamber: Chamber = 'federal-house',
): Promise<{ summaries: Map<string, StateSummary>; seats: Map<string, number> }> {
  const summaries = new Map<string, StateSummary>();
  const seats = new Map<string, number>();
  for (const s of states) {
    const path = join(publicDir, planDir(s.abbr, chamber), 'stats.json');
    if (!existsSync(path)) continue;
    const parsed = PublishedStatsSchema.safeParse(await readJson(path));
    if (!parsed.success) throw new DataError(`${path}: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
    summaries.set(s.abbr, summarize(parsed.data.finished.metrics, parsed.data.versions, parsed.data.beforeBalancing?.metrics.assignmentSha256));
    const drawn = parsed.data.finished.metrics.seats;
    if (drawn !== undefined) seats.set(s.abbr, drawn);
  }
  return { summaries, seats };
}

interface Shared {
  readonly countyNames: ReadonlyMap<string, string>;
  /** The national enacted file of the Federal House; a state chamber reads its own state's file instead. */
  readonly enacted: EnactedFile | undefined;
  /** All states' land merged into one layer (GeoJSON text), for the water masks. */
  readonly land: string;
}

/** The two plans of a state exactly as the provenance check and the publish gate saw them. */
export interface GatedPlans {
  readonly finished: PlanMetrics;
  readonly before: PlanMetrics;
}

/**
 * Refuse files that are not the plans the gate checked. The gate ran on metrics.json earlier in the run; the files
 * published from are read later, so an `explore` running in between could swap in an unchecked plan, or leave a
 * finished plan from one run beside a before-balancing plan from another. The assignment CSVs are compared with the
 * fingerprints the gate saw (sha256 of the CSV text, as metrics.json records it). The districts, cuts and balance
 * files are covered by that: `explore` rewrites them together with the CSVs.
 */
export function assertGatedAssignments(abbr: string, gated: GatedPlans, finishedCsv: string, beforeCsv: string): void {
  const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');
  if (sha256(finishedCsv) !== gated.finished.assignmentSha256 || sha256(beforeCsv) !== gated.before.assignmentSha256) {
    throw new DataError(`${abbr}: out/${abbr} changed after it was checked; do not run explore while publish-data runs`);
  }
}

async function publishState(state: StateInfo, cfg: PublishRunConfig, shared: Shared, gated: GatedPlans): Promise<void> {
  const dir = planDir(state.abbr, cfg.chamber);
  const src = join(cfg.outDir, dir);
  const srcBefore = join(src, 'before-balancing');
  const dest = join(cfg.publicDir, dir);
  const enacted = shared.enacted ?? (await loadEnacted(cfg.cacheDir, cfg.chamber, state));
  const budget = districtBudget(state.seats);

  // The metrics the gate checked, not a fresh read: see assertGatedAssignments.
  const { finished: official, before } = gated;
  const versions = stampOf(VERSIONS);
  const [officialCsv, beforeCsv] = [await readFile(join(src, 'assignment.csv'), 'utf8'), await readFile(join(srcBefore, 'assignment.csv'), 'utf8')];
  assertGatedAssignments(state.abbr, gated, officialCsv, beforeCsv);
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
  const log = BalanceLogSchema.safeParse(await readJson(join(src, 'balance.json')));
  if (!log.success) throw new DataError(`${src}/balance.json: ${log.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
  if (log.data.moves.length !== official.balanceMoves) throw new DataError(`${src}/balance.json: ${log.data.moves.length} moves, but metrics.json reports ${official.balanceMoves}`);
  const stats = buildStats(
    planStats(official, countiesByDistrict(officialCsv, state.seats, shared.countyNames), finishedParts, borderOnlyMoves(log.data)),
    planStats(before, countiesByDistrict(beforeCsv, state.seats, shared.countyNames), beforeParts),
    enacted.source,
    versions,
  );

  // The display copies of a state that crosses the antimeridian are drawn in one continuous frame; the generator's files are not touched.
  const wrapped = crossesAntimeridian(state.abbr);
  const display = <T extends { readonly geometry: unknown }>(fs: readonly T[]): T[] => (wrapped ? unwrapFeatures(fs) : [...fs]);
  const districts = (await readJson(join(src, 'districts.geojson'))) as Parameters<typeof toTopology>[0];
  const outputs: [string, string | Uint8Array][] = [];
  const districtsTopo = await toTopology({ features: display(districts.features) }, 'districts', budget);
  outputs.push(['districts.topo.json', districtsTopo]);
  const stateChamber = cfg.chamber === 'federal-house' ? undefined : cfg.chamber;
  const imageName = stateChamber === undefined ? state.name : `${state.name} ${CHAMBER_NAME[stateChamber]}`;
  const credit = ogCredit({ abbr: stateChamber === undefined ? state.abbr : `${state.abbr}/${CHAMBER_SEGMENT[stateChamber]}`, name: imageName, versions, assignmentSha256: official.assignmentSha256 });
  const fonts = await loadOgFonts();
  outputs.push(['og.png', renderOgPng(ogSvg({ name: imageName, abbr: state.abbr, seats: state.seats, topo: districtsTopo, credit, palette: OG_PALETTE }), fonts)]);
  outputs.push(...stateBadgeFiles({ name: state.name, abbr: state.abbr, seats: state.seats, chamber: cfg.chamber, topo: districtsTopo }, fonts));
  const beforeDistricts = (await readJson(join(srcBefore, 'districts.geojson'))) as Parameters<typeof toTopology>[0];
  const beforeTopo = await toTopology({ features: display(beforeDistricts.features) }, 'districts', budget);
  outputs.push(['before.topo.json', beforeTopo]);
  outputs.push(['before-neighbors.json', buildBeforeNeighbors(beforeTopo, state.seats)]);

  // Water is display only: the area the districts cover less the shoreline-clipped land. It gets half the district vertex budget.
  const water = await buildWater(await readFile(join(src, 'districts.geojson'), 'utf8'), shared.land);
  outputs.push(['water.topo.json', await toTopology({ features: display(water.features) }, 'water', Math.round(budget / 2))]);

  const bridgeCount = official.bridges;
  if (bridgeCount === undefined) throw new DataError(`${src}/metrics.json: bridges is missing; re-run explore for ${state.abbr}`);
  outputs.push(['bridges.json', JSON.stringify(await buildPublishedBridges(src, state.abbr, bridgeCount, officialCsv, beforeCsv))]);

  outputs.push(['enacted.topo.json', await buildEnactedTopology(state, enacted)]);

  const cuts = buildCuts(await readJson(join(src, 'cuts.geojson')));
  outputs.push(['cuts.json', JSON.stringify(wrapped ? cuts.map((c) => ({ ...c, lines: unwrapCoordinates(c.lines) })) : cuts)]);
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

  // Every output of THIS state is built and checked above; only now do this state's files in the public directory
  // change, stats.json last. The run as a whole is not atomic: states.topo.json was written before the first state and
  // states are written one at a time, so a failure here leaves earlier states updated and later ones untouched.
  await mkdir(dest, { recursive: true });
  // A one-district state has no blocks.pmtiles; a file left by an earlier run would be stale.
  if (!borderTiles) await rm(join(dest, 'blocks.pmtiles'), { force: true });
  for (const [name, body] of outputs) await write(join(dest, name), body);
  const rawBytes = Buffer.byteLength(blocksJson);
  console.log(`  ${state.abbr}: detail.pmtiles ${tiles.byteLength} B, blocks.pmtiles ${borderTiles ? `${borderTiles.byteLength} B` : 'none (one district)'}, blocks.json ${rawBytes} B (${gzipSync(blocksJson).byteLength} B gzip)`);

  await write(join(dest, 'stats.json'), JSON.stringify(stats));
}

/** The stamp and fingerprint of a state already in the public directory, or null when nothing is published. */
async function readPublishedState(statsPath: string): Promise<PublishedPlan | null> {
  if (!existsSync(statsPath)) return null;
  const parsed = GateStatsSchema.safeParse(await readJson(statsPath));
  if (!parsed.success) throw new DataError(`${statsPath}: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
  const { finished, beforeBalancing, versions } = parsed.data;
  return {
    ...(versions ? { versions } : {}),
    sha: finished.metrics.assignmentSha256,
    beforeSha: beforeBalancing?.metrics.assignmentSha256,
    inputSha256: finished.metrics.inputSha256,
    seats: finished.metrics.seats,
  };
}

/** The most sampled blocks that may be too thin for a tile point check, as a share of those sampled. */
export const MAX_THIN_SHARE = 0.01;

/**
 * Every 1-in-N block (about TILE_CHECK_SAMPLE) plus every moved block must land in the district the CSVs give, under both
 * plans. Each block is tested at a point at least DEEP_POINT_MARGIN tile units inside its edges (its Census interior point
 * when that is far enough in), since a point closer to a border than tile rounding can land on either side of it.
 * A block too thin to hold such a point anywhere cannot be tested by a point lookup: it is counted and logged, and the run
 * is refused when more than MAX_THIN_SHARE of the sampled blocks are thin, or when none could be checked at all. A moved
 * block is never skipped silently: one that is too thin is named in the log.
 */
export async function verifyTiles(state: StateInfo, all: readonly Block[], tiles: Uint8Array, file: BlocksFile, moved: ReadonlySet<string>, wrapped: boolean): Promise<void> {
  const stride = Math.max(1, Math.floor(all.length / TILE_CHECK_SAMPLE));
  const lon = (x: number): number => (wrapped ? unwrapLon(x) : x);
  const picked: { geoid: string; point: [number, number] }[] = [];
  let thin = 0;
  const thinMoved: string[] = [];
  all.forEach((b, i) => {
    if (i % stride !== 0 && !moved.has(b.geoid)) return;
    const point = deepSamplePoint(b.rings.map((r) => r.map((p) => [lon(p[0]), p[1]])), [lon(b.point[0]), b.point[1]]);
    if (point) picked.push({ geoid: b.geoid, point });
    else {
      thin++;
      if (moved.has(b.geoid)) thinMoved.push(b.geoid);
    }
  });
  if (thin > 0) {
    const movedNote = thinMoved.length > 0 ? `, ${thinMoved.length} of them moved by balancing (first ${MAX_MISSES_LISTED}: ${thinMoved.slice(0, MAX_MISSES_LISTED).join(', ')})` : '';
    console.log(`  ${state.abbr}: ${thin} of ${picked.length + thin} sampled blocks are too thin for a tile point check and were skipped${movedNote}`);
  }
  if (picked.length === 0) throw new DataError(`${state.abbr}: no sampled block could be checked against the detail tiles (${thin} too thin for a point check)`);
  if (thin / (picked.length + thin) > MAX_THIN_SHARE) {
    throw new DataError(`${state.abbr}: ${thin} of ${picked.length + thin} sampled blocks are too thin for a tile point check, more than ${MAX_THIN_SHARE * 100}%; the detail tiles cannot be verified`);
  }
  const misses: string[] = [];
  for (let i = 0; i < picked.length; i += POINTS_PER_BATCH) {
    const batch = picked.slice(i, i + POINTS_PER_BATCH);
    const points = batch.map((b) => b.point);
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

/** The states an overlay-only or blocks-only run covers: those already published for the chamber, or the explicit selection (which must be published). */
function selectPublished(cfg: PublishRunConfig): StateInfo[] {
  const has = (s: StateInfo): boolean => existsSync(join(cfg.publicDir, planDir(s.abbr, cfg.chamber), 'stats.json'));
  const published = withChamberSeats(STATES.filter(has), cfg.chamber);
  if (cfg.states === undefined) return published;
  const requested = withChamberSeats(cfg.states, cfg.chamber);
  for (const s of requested) {
    if (!published.some((p) => p.abbr === s.abbr)) throw new DataError(`${s.abbr}: nothing published in ${cfg.publicDir}, so there is no data to update`);
  }
  return requested;
}

const EnactedStatsSchema = z.looseObject({
  enactedSource: z.string(),
  versions: PublishedStampSchema.optional(),
  finished: z.looseObject({ metrics: z.looseObject({ seats: z.number().int().optional() }) }).optional(),
});

const StampOnlySchema = z.looseObject({ versions: PublishedStampSchema.optional() });

/** The stamp of every published map in every chamber, named by its folder. */
async function publishedStamps(publicDir: string): Promise<{ abbr: string; versions?: VersionStamp }[]> {
  const published: { abbr: string; versions?: VersionStamp }[] = [];
  for (const s of STATES) {
    for (const c of ['federal-house', ...STATE_CHAMBERS] as const) {
      const path = join(publicDir, planDir(s.abbr, c), 'stats.json');
      if (!existsSync(path)) continue;
      // Only the stamp is read, so data published under an older layout still counts.
      const parsed = StampOnlySchema.safeParse(await readJson(path));
      if (!parsed.success) throw new DataError(`${path}: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
      published.push({ abbr: planDir(s.abbr, c), ...(parsed.data.versions ? { versions: parsed.data.versions } : {}) });
    }
  }
  return published;
}

/**
 * Rebuild only what depends on the enacted-districts file, from the files already published: each state's
 * `enacted.topo.json` and the `enactedSource` in its `stats.json`. It needs no generated plans, and writes a file
 * only when its bytes change, so a run against the file the data was built from touches nothing. The index and
 * every other file are left alone: none of them depends on the enacted districts. A chamber is run at a time
 * (`--chamber`); an update that touches every chamber runs all three. A chamber whose published district count is not
 * the current Census count keeps its old stamp (its map needs a redraw), and the dataset-wide versions file moves
 * only when no published map in any chamber still carries an older stamp.
 */
export async function publishEnactedOnly(cfg: PublishRunConfig): Promise<void> {
  const selected = selectPublished(cfg);
  const stamp = stampOf(VERSIONS);
  // The Federal House reads one national file; a state chamber reads each state's own.
  const national = cfg.chamber === 'federal-house' ? await loadEnacted(cfg.cacheDir, cfg.chamber) : undefined;
  if (national) console.log(`enacted source: ${national.source}`);
  // Everything is built and checked first, so a state that fails leaves the public directory untouched.
  const built: { state: StateInfo; dir: string; statsPath: string; stats: z.infer<typeof EnactedStatsSchema>; enacted: EnactedFile; topo: string }[] = [];
  for (const s of selected) {
    const dir = join(cfg.publicDir, planDir(s.abbr, cfg.chamber));
    const statsPath = join(dir, 'stats.json');
    const stats = EnactedStatsSchema.safeParse(await readJson(statsPath));
    if (!stats.success) throw new DataError(`${statsPath}: ${stats.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
    const enacted = national ?? (await loadEnacted(cfg.cacheDir, cfg.chamber, s));
    if (!national) console.log(`  ${s.abbr} enacted source: ${enacted.source}`);
    built.push({ state: s, dir, statsPath, stats: stats.data, enacted, topo: await buildEnactedTopology(s, enacted) });
  }
  for (const b of built) {
    const changed = [await writeIfChanged(join(b.dir, 'enacted.topo.json'), b.topo)];
    // Parsing keeps key order, and the file is written with JSON.stringify, so only these values can change. The
    // assignments are untouched, so no gate: a stamped state takes the current maps release and input revision.
    const stale = b.stats.finished?.metrics.seats !== undefined && b.stats.finished.metrics.seats !== b.state.seats;
    if (stale) console.log(`  ${b.state.abbr}: published with ${String(b.stats.finished?.metrics.seats)} districts, the Census count is ${b.state.seats}; needs redraw, stamp kept`);
    const stamped = b.stats.versions !== undefined && !stale;
    changed.push(await writeIfChanged(b.statsPath, JSON.stringify({ ...b.stats, enactedSource: b.enacted.source, ...(stamped ? { versions: restamped(b.stats.versions!, stamp) } : {}) })));
    console.log(`  ${b.state.abbr}: ${changed.some(Boolean) ? 'updated' : 'unchanged'}`);
  }
  // The index and versions file describe every chamber, so they are rebuilt by one run at a time.
  await withDirLock(cfg.publicDir, async () => {
    const stampedStates = built.filter((b) => b.stats.versions !== undefined && !(b.stats.finished?.metrics.seats !== undefined && b.stats.finished.metrics.seats !== b.state.seats));
    if (stampedStates.length > 0) {
      await restampIndex(join(cfg.publicDir, 'index.json'), cfg.chamber, new Map(stampedStates.map((b) => [b.state.abbr, restamped(b.stats.versions!, stamp)])));
    }
    // The versions file speaks for every published map in every chamber, so it moves only when none carries an older stamp.
    const published = await publishedStamps(cfg.publicDir);
    // No map was regenerated, so a stamp is current when its maps release and input match; engine and schema stay as drawn.
    const olderStamps = staleStamps(published.map((p) => (p.versions ? { abbr: p.abbr, versions: { ...p.versions, engine: stamp.engine, schema: stamp.schema } } : p)), stamp);
    if (published.length > 0 && olderStamps.length === 0) {
      await writeIfChanged(join(cfg.publicDir, 'versions.json'), formatVersions(await restampedVersions(join(cfg.publicDir, 'versions.json'))));
    } else if (olderStamps.length > 0) console.log(`versions.json kept: ${olderStamps.join(', ')} still carry an older stamp`);
  });
}

/**
 * The versions file for the published data after a restamp: the engine, schema, web and docs stay as already published
 * (no map was regenerated), and only the maps release and the input follow the current versions. With no readable file
 * there is nothing to keep, so it is the current versions.
 */
async function restampedVersions(path: string): Promise<Versions> {
  if (!existsSync(path)) return VERSIONS;
  const published = VersionsSchema.safeParse(await readJson(path));
  if (!published.success) return VERSIONS;
  return { ...published.data, maps: VERSIONS.maps, input: { ...VERSIONS.input } };
}

/** A published stamp moved to the current Maps release and input revision. The engine and schema stay: no map was regenerated. */
const restamped = (old: VersionStamp, current: VersionStamp): VersionStamp => ({ ...old, maps: current.maps, input: current.input });

/** Replace `summary.versions` in the index for the given states; everything else in the file is kept as parsed. */
async function restampIndex(path: string, chamber: Chamber, states: ReadonlyMap<string, VersionStamp>): Promise<void> {
  if (!existsSync(path)) return;
  const Summarized = z.looseObject({ summary: z.looseObject({}).optional() });
  const IndexShape = z.looseObject({ states: z.array(z.looseObject({ abbr: z.string(), summary: z.looseObject({}).optional(), chambers: z.looseObject({}).optional() })) });
  const parsed = IndexShape.safeParse(await readJson(path));
  if (!parsed.success) throw new DataError(`${path}: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
  const restamp = <T extends { summary?: object | undefined }>(e: T, abbr: string): T =>
    e.summary !== undefined && states.has(abbr) ? { ...e, summary: { ...e.summary, versions: states.get(abbr) } } : e;
  const next = {
    ...parsed.data,
    states: parsed.data.states.map((e) => {
      if (chamber === 'federal-house') return restamp(e, e.abbr);
      // A state chamber's summary sits under `chambers`; the federal fields are left as they are.
      const entry = e.chambers?.[chamber];
      const own = Summarized.safeParse(entry);
      return own.success && e.chambers ? { ...e, chambers: { ...e.chambers, [chamber]: restamp(own.data, e.abbr) } } : e;
    }),
  };
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
export async function publishBlocksOnly(cfg: PublishRunConfig): Promise<void> {
  for (const s of selectPublished(cfg)) {
    const dir = join(cfg.publicDir, planDir(s.abbr, cfg.chamber));
    const path = join(dir, 'blocks.json');
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
    const statsPath = join(dir, 'stats.json');
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
    const out = join(dir, 'blocks.pmtiles');
    if (bytes) await write(out, bytes);
    else await rm(out, { force: true });
    console.log(`  ${s.abbr}: blocks.pmtiles ${bytes ? `${bytes.byteLength} B` : 'none (one district)'}`);
  }
}

const BadgeStatsSchema = z.looseObject({ finished: z.looseObject({ metrics: z.looseObject({ seats: z.number().int().optional() }) }) });

/** Rewrite only each published state's four badge files, from its published districts and seat count. Every other file is left alone. */
export async function publishBadgesOnly(cfg: PublishRunConfig): Promise<void> {
  const fonts = await loadOgFonts();
  for (const s of selectPublished(cfg)) {
    const dir = join(cfg.publicDir, planDir(s.abbr, cfg.chamber));
    const statsPath = join(dir, 'stats.json');
    const stats = BadgeStatsSchema.safeParse(await readJson(statsPath));
    if (!stats.success) throw new DataError(`${statsPath}: ${stats.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
    const seats = stats.data.finished.metrics.seats ?? s.seats;
    const topo = await readFile(join(dir, 'districts.topo.json'), 'utf8');
    for (const [name, bytes] of stateBadgeFiles({ name: s.name, abbr: s.abbr, seats, chamber: cfg.chamber, topo }, fonts)) await write(join(dir, name), bytes);
    console.log(`  ${s.abbr}: badge files written`);
  }
}

/** Why a state's plans are not a finished draw by the current code (undefined when they are). Supplied by the caller, which owns the run stamp. */
export type PlanStaleCheck = (state: StateInfo, dir: string) => Promise<string | undefined>;

export interface PublishOptions {
  /** Asked about every selected state before anything is written. */
  readonly planStale: PlanStaleCheck;
  /** Before the 1.0 cut a changed map may replace a published one. */
  readonly preRelease?: boolean;
}

/** Write the web-ready data for the selected states (default: every state with a generated plan), plus the national files and the index. */
export async function publishData(cfg: PublishRunConfig, { planStale, preRelease = false }: PublishOptions): Promise<void> {
  if (cfg.badgesOnly) return publishBadgesOnly(cfg);
  if (cfg.enactedOnly) return publishEnactedOnly(cfg);
  if (cfg.blocksOnly) return publishBlocksOnly(cfg);
  const withData = statesWithData(cfg.outDir, cfg.chamber);
  // A state with no such chamber (seats 0) is skipped with a note, also when named; it is never "missing".
  const covered = withChamberSeats(cfg.states ?? STATES, cfg.chamber);
  const selected = withChamberSeats(withData, cfg.chamber).filter((s) => cfg.states === undefined || cfg.states.some((x) => x.abbr === s.abbr));
  const missing = (cfg.states === undefined ? [] : covered).filter((s) => !withData.some((w) => w.abbr === s.abbr)).map((s) => s.abbr);
  if (missing.length > 0) throw new DataError(`no generated plan in ${cfg.outDir} for ${missing.join(', ')}; run \`npm run explore -- --states ${missing.join(',')}${cfg.chamber === 'federal-house' ? '' : ` --chamber ${cfg.chamber}`}\` first`);
  // Before any write: every plan must come from the current engine major and the pinned census, and a map may only
  // change when the engine major or the census input moves. One refused state refuses the run.
  const versions = stampOf(VERSIONS);
  const checked = new Map<string, GatedPlans>();
  // Stamps first: a plan that was never finished by the current code is not worth reading.
  for (const s of selected) {
    const stale = await planStale(s, join(cfg.outDir, planDir(s.abbr, cfg.chamber)));
    if (stale !== undefined) throw new DataError(`${s.abbr}: ${stale}; re-run explore for it`);
  }
  for (const s of selected) {
    const { finished, before } = await readCheckedPlans(s, cfg.outDir, cfg.chamber);
    checked.set(s.abbr, { finished, before });
    const next = { versions, sha: finished.assignmentSha256, beforeSha: before.assignmentSha256, inputSha256: finished.inputSha256, seats: finished.seats };
    checkPublishGate(await readPublishedState(join(cfg.publicDir, planDir(s.abbr, cfg.chamber), 'stats.json')), next, cfg.baseline, cfg.chamber === 'federal-house' ? s.abbr : `${s.abbr} ${cfg.chamber}`, preRelease);
  }
  await mkdir(cfg.publicDir, { recursive: true });

  const outlines = (await loadStates(cfg.cacheDir)).filter((o) => STATES.some((s) => s.abbr === o.abbr));
  await write(
    join(cfg.publicDir, 'states.topo.json'),
    await toTopology({ features: outlines.map((o) => ({ type: 'Feature', properties: { abbr: o.abbr, name: o.name }, geometry: o.geometry as { coordinates?: unknown } })) }, 'states', NATIONAL_BUDGET),
  );

  const shared: Shared = { countyNames: await loadCountyNames(cfg.cacheDir), enacted: cfg.chamber === 'federal-house' ? await loadEnacted(cfg.cacheDir, cfg.chamber) : undefined, land: await mergeLand(await loadLand(cfg.cacheDir)) };
  for (const s of selected) {
    console.log(`publishing ${s.abbr}`);
    await publishState(s, cfg, shared, checked.get(s.abbr)!);
  }

  // The index describes what is in the public directory, after this run's states are written. Another run may be
  // writing its own states at the same time, so the index and versions are rebuilt by one run at a time.
  await withDirLock(cfg.publicDir, async () => {
    // Every state lists both state chambers, drawn or not, so the viewer can tell "not drawn yet" from "has none".
    const house = await publishedChamberData(cfg.publicDir, STATES, 'state-house');
    const senate = await publishedChamberData(cfg.publicDir, STATES, 'state-senate');
    const chambers = { 'state-house': house.summaries, 'state-senate': senate.summaries };
    const index = buildIndex(STATES, await publishedSummaries(cfg.publicDir), chambers, { 'state-house': house.seats, 'state-senate': senate.seats });
    await write(join(cfg.publicDir, 'index.json'), JSON.stringify(index));
    // The versions file speaks for the whole published dataset, so it moves to the current versions only when every
    // published state now carries the current stamp; after a partial run that left older stamps it stays as it was.
    const stale = staleStamps(await publishedStamps(cfg.publicDir), versions);
    if (stale.length === 0) await write(join(cfg.publicDir, 'versions.json'), formatVersions(VERSIONS));
    else console.log(`versions.json kept: ${stale.join(', ')} still carry an older stamp`);
  });
}
