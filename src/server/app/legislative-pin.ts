import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isAbsentUpstream, isLegislativeFile, legislativeFileName, legislativeUrl, type LegislativeChamber } from '../entities/legislative-boundary/index.js';
import { probeSource, SourcesSchema, type Source } from '../features/census-watch/index.js';
import { STATES } from '../shared/apportionment/index.js';
import { ENACTED_CONFIG, ManifestSchema, parseLegislativeConfig } from '../shared/config/index.js';
import { exitCodeFor } from '../shared/errors/index.js';
import { adoptIfAccepted, downloadForPinning } from '../shared/http/index.js';

// `legislative:pin` downloads every State House and State Senate file of the configured vintage, pins its hash in
// config/census-sha256.json, records where it is served in config/census-sources.json, then writes the counts file.
// Any older legislative pins are dropped. A chamber the Census Bureau serves no file for (HTTP 404) is pinned as nothing.

const CONCURRENCY = 4;
const CHAMBERS: readonly LegislativeChamber[] = ['state-house', 'state-senate'];

const sortedJson = (o: Readonly<Record<string, unknown>>): string =>
  `${JSON.stringify(Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))), null, 2)}\n`;

async function readJson(path: string): Promise<unknown> {
  return JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, '')) as unknown;
}

async function main(): Promise<void> {
  const cfg = parseLegislativeConfig(process.argv.slice(2));
  const vintage = ENACTED_CONFIG.legislative.vintage;
  const manifestPath = join(cfg.configDir, 'census-sha256.json');
  const sourcesPath = join(cfg.configDir, 'census-sources.json');
  const manifest = { ...ManifestSchema.parse(await readJson(manifestPath)) };
  const sources: Record<string, Source> = { ...SourcesSchema.parse(await readJson(sourcesPath)) };
  for (const name of Object.keys(manifest)) if (isLegislativeFile(name)) delete manifest[name];
  for (const name of Object.keys(sources)) if (isLegislativeFile(name)) delete sources[name];

  const jobs = STATES.flatMap((state) => CHAMBERS.map((chamber) => ({ state, chamber })));
  const absent: string[] = [];
  let next = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (next < jobs.length) {
      const { state, chamber } = jobs[next++]!;
      const file = legislativeFileName(state, chamber, vintage);
      const name = `${file}.zip`;
      const url = legislativeUrl(file);
      const label = `${state.abbr} ${chamber}`;
      if (await isAbsentUpstream(url, probeSource)) {
        absent.push(label);
        continue;
      }
      const cachePath = join(cfg.cacheDir, name);
      const fresh = await downloadForPinning(url, cachePath, label);
      await adoptIfAccepted(fresh.path, cachePath, async () => undefined);
      manifest[name] = fresh.sha256;
      sources[name] = await probeSource(url);
    }
  }));

  await writeFile(manifestPath, sortedJson(ManifestSchema.parse(manifest)), 'utf8');
  await writeFile(sourcesPath, sortedJson(SourcesSchema.parse(sources)), 'utf8');
  console.log(`pinned ${Object.keys(manifest).filter(isLegislativeFile).length} files; no file served for: ${absent.sort().join(', ') || 'none'}`);
  // The counter reads the manifest when it starts, so it runs as a fresh process now that the pins are written.
  execFileSync(process.execPath, ['--import', 'tsx', 'src/server/app/legislative-count.ts', '--cache-dir', cfg.cacheDir, '--config-dir', cfg.configDir], { stdio: 'inherit' });
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : 'legislative:pin failed');
  process.exit(exitCodeFor(err));
});
