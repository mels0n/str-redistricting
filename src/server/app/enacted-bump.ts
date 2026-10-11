import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyBump, applyLegislativeBump, checkCoverage, planVersionBump, redrawLines } from '../features/enacted/index.js';
import { boundaryUrl, parseCdRecord, readBoundaryZip } from '../features/publish/index.js';
import {
  formatVersions, inputSha256Of, LegislativeDistrictsSchema, parseEnactedBumpConfig, VersionsSchema,
  type EnactedBumpConfig, type LegislativeDistricts,
} from '../shared/config/index.js';
import { DataError, exitCodeFor } from '../shared/errors/index.js';
import { adoptIfAccepted, downloadForPinning } from '../shared/http/index.js';

const VERSIONS_JSON = 'versions.json';

/** Insert `## <version> (<date>)` and a bullet per line under the title of a changelog, creating the file when it is missing. */
async function prependChangelog(path: string, title: string, version: string, lines: readonly string[]): Promise<void> {
  const date = new Date().toISOString().slice(0, 10);
  const md = existsSync(path) ? await readFile(path, 'utf8') : `# ${title} changelog\n\n`;
  const at = md.indexOf('\n') + 1;
  const head = md.slice(0, at).trimEnd();
  const rest = md.slice(at).replace(/^\n+/, '');
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, `${head}\n\n## ${version} (${date})\n\n${lines.map((l) => `- ${l}\n`).join('')}${rest === '' ? '' : `\n${rest}`}`);
}

/**
 * The input files just changed, so the input revision and the maps release move with them: recompute the input
 * fingerprint, write config/versions.json and add the changelog entries. Nothing changes if the fingerprint did not.
 */
async function bumpVersions(configDir: string, inputLines: readonly string[], mapsLines: readonly string[]): Promise<void> {
  const versionsPath = join(configDir, VERSIONS_JSON);
  const current = VersionsSchema.parse(JSON.parse(await readFile(versionsPath, 'utf8')) as unknown);
  const sha = inputSha256Of(await readFile(join(configDir, 'census-sha256.json'), 'utf8'), await readFile(join(configDir, 'enacted.json'), 'utf8'));
  if (sha === current.input.sha256) return;
  const next = planVersionBump(current, sha);
  await writeFile(versionsPath, formatVersions(next));
  const changelogDir = join(configDir, '..', 'changelog');
  await prependChangelog(join(changelogDir, 'input.md'), 'Input', `${next.input.vintage} r${next.input.revision}`, inputLines);
  await prependChangelog(join(changelogDir, 'maps.md'), 'Maps', String(next.maps), mapsLines);
  console.log(`input revision ${next.input.revision}, maps release ${next.maps}`);
}

/** `publish-data --enacted-only` in a fresh process, so the publisher reads the config just written. No chamber is the Federal House. */
function publishEnactedOnly(cfg: EnactedBumpConfig, chamber?: string): void {
  const publish = fileURLToPath(new URL('./publish.ts', import.meta.url));
  const run = spawnSync(
    process.execPath,
    ['--max-old-space-size=8192', '--import', 'tsx', publish, '--enacted-only', ...(chamber === undefined ? [] : ['--chamber', chamber]), '--cache-dir', cfg.cacheDir, '--public-dir', cfg.publicDir],
    { stdio: 'inherit' },
  );
  if (run.status !== 0) {
    throw new DataError(`publish-data --enacted-only${chamber === undefined ? '' : ` --chamber ${chamber}`} failed (exit ${String(run.status)})`);
  }
}

async function bumpFile(cfg: EnactedBumpConfig & { readonly file: string }): Promise<void> {
  const cachePath = join(cfg.cacheDir, `${cfg.file}.zip`);
  const { path, sha256 } = await downloadForPinning(boundaryUrl(cfg.file), cachePath, cfg.file);
  // The download replaces the cached zip only once the bump is accepted, so a refused one keeps the copy the manifest pins.
  const plan = await adoptIfAccepted(path, cachePath, async () => {
    // The archive must parse and hold districts for every state, or it is not pinned.
    checkCoverage((await readBoundaryZip(path, cfg.file)).map((f) => parseCdRecord(f.properties).stateFp), cfg.file);
    return applyBump(cfg.configDir, cfg.file, sha256);
  });
  console.log(`adopted ${plan.config.file} (Congress ${plan.config.congress}), sha256 ${sha256}`);
  await bumpVersions(
    cfg.configDir,
    [`Comparison districts updated to Congress ${plan.config.congress} (${cfg.file}).`],
    [`Comparison districts updated to Congress ${plan.config.congress}. No district lines changed.`],
  );
  if (!cfg.skipPublish) publishEnactedOnly(cfg);
}

const readCounts = async (configDir: string): Promise<LegislativeDistricts['states']> =>
  LegislativeDistrictsSchema.parse(JSON.parse((await readFile(join(configDir, 'legislative-districts.json'), 'utf8')).replace(/^﻿/, '')) as unknown).states;

/**
 * Adopt a new State House and State Senate vintage: re-pin every file (the pin command drops the old vintage's pins and
 * reruns the counter), then move the versions and list the states whose district count changed as needing a redraw.
 */
async function bumpLegislative(cfg: EnactedBumpConfig & { readonly legislative: number }): Promise<void> {
  const before = await readCounts(cfg.configDir);
  const next = await applyLegislativeBump(cfg.configDir, cfg.legislative);
  console.log(`legislative vintage ${next.legislative.vintage}`);
  // A fresh process: the pin and count commands read the vintage from the config that was just written.
  const pin = fileURLToPath(new URL('./legislative-pin.ts', import.meta.url));
  const run = spawnSync(process.execPath, ['--import', 'tsx', pin, '--cache-dir', cfg.cacheDir, '--config-dir', cfg.configDir], { stdio: 'inherit' });
  if (run.status !== 0) throw new DataError(`legislative:pin failed (exit ${String(run.status)})`);
  const redraw = redrawLines(before, await readCounts(cfg.configDir));
  for (const line of redraw) console.log(line);
  await bumpVersions(
    cfg.configDir,
    [`State House and State Senate districts updated to the ${cfg.legislative} Census files.`, ...redraw],
    [`State House and State Senate comparison districts updated to the ${cfg.legislative} Census files. No district lines changed.`],
  );
  if (cfg.skipPublish) return;
  publishEnactedOnly(cfg, 'state-house');
  publishEnactedOnly(cfg, 'state-senate');
}

const bump = (cfg: EnactedBumpConfig): Promise<void> => ('legislative' in cfg ? bumpLegislative(cfg) : bumpFile(cfg));

try {
  await bump(parseEnactedBumpConfig(process.argv.slice(2)));
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(exitCodeFor(err));
}
