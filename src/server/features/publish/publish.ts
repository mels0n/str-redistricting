import { existsSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { STATES, type StateInfo } from '../../shared/apportionment/index.js';
import type { PublishConfig } from '../../shared/config/index.js';
import { DataError } from '../../shared/errors/index.js';
import { loadCountyNames, loadEnacted, loadStates, type EnactedFile } from './boundary.js';
import { countiesByDistrict } from './counties.js';
import { buildCuts } from './cuts.js';
import { buildStats, planStats } from './stats.js';
import { buildIndex, PlanMetricsSchema, summarize, type PlanMetrics, type StateSummary } from './summary.js';
import { districtBudget, toTopology } from './topo.js';

const NATIONAL_BUDGET = 12000;

const readJson = async (path: string): Promise<unknown> => JSON.parse(await readFile(path, 'utf8'));
const write = (path: string, body: string) => writeFile(path, body);

async function readMetrics(dir: string): Promise<PlanMetrics> {
  const parsed = PlanMetricsSchema.safeParse(await readJson(join(dir, 'metrics.json')));
  if (!parsed.success) throw new DataError(`${dir}/metrics.json: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
  return parsed.data;
}

async function generatedDate(dir: string): Promise<string> {
  return (await stat(join(dir, 'metrics.json'))).mtime.toISOString().slice(0, 10);
}

/** States whose generated plan is present in the output directory. */
export const statesWithData = (outDir: string): StateInfo[] => STATES.filter((s) => existsSync(join(outDir, s.abbr, 'metrics.json')));

interface Shared {
  readonly countyNames: ReadonlyMap<string, string>;
  readonly enacted: EnactedFile;
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

  const districts = (await readJson(join(src, 'districts.geojson'))) as Parameters<typeof toTopology>[0];
  await write(join(dest, 'districts.topo.json'), await toTopology(districts, 'districts', budget));
  const beforeDistricts = (await readJson(join(srcBefore, 'districts.geojson'))) as Parameters<typeof toTopology>[0];
  await write(join(dest, 'before.topo.json'), await toTopology(beforeDistricts, 'districts', budget));

  const enacted = shared.enacted.features
    .filter((f) => f.record.stateFp === state.fips)
    .sort((a, b) => a.record.code.localeCompare(b.record.code))
    .map((f) => ({ type: 'Feature', properties: { label: f.record.label, code: f.record.code }, geometry: f.geometry as { coordinates?: unknown } }));
  if (enacted.length === 0) throw new DataError(`${state.abbr}: no enacted districts in ${shared.enacted.source}`);
  await write(join(dest, 'enacted.topo.json'), await toTopology({ features: enacted }, 'enacted', budget));

  await write(join(dest, 'cuts.json'), JSON.stringify(buildCuts(await readJson(join(src, 'cuts.geojson')))));
  await write(join(dest, 'stats.json'), JSON.stringify(stats));
}

/** Write the web-ready data for every state with a generated plan, plus the national files. */
export async function publishData(cfg: PublishConfig): Promise<void> {
  const withData = statesWithData(cfg.outDir);
  const selected = cfg.states === undefined ? withData : withData.filter((s) => cfg.states!.some((x) => x.abbr === s.abbr));
  await mkdir(cfg.publicDir, { recursive: true });

  const summaries = new Map<string, StateSummary>();
  for (const s of withData) {
    const dir = join(cfg.outDir, s.abbr);
    summaries.set(s.abbr, summarize(await readMetrics(dir), await generatedDate(dir)));
  }
  await write(join(cfg.publicDir, 'index.json'), JSON.stringify(buildIndex(STATES, summaries)));

  const outlines = (await loadStates(cfg.cacheDir)).filter((o) => STATES.some((s) => s.abbr === o.abbr));
  await write(
    join(cfg.publicDir, 'states.topo.json'),
    await toTopology({ features: outlines.map((o) => ({ type: 'Feature', properties: { abbr: o.abbr, name: o.name }, geometry: o.geometry as { coordinates?: unknown } })) }, 'states', NATIONAL_BUDGET),
  );

  const shared: Shared = { countyNames: await loadCountyNames(cfg.cacheDir), enacted: await loadEnacted(cfg.cacheDir) };
  for (const s of selected) {
    console.log(`publishing ${s.abbr}`);
    await publishState(s, cfg, shared);
  }
}
