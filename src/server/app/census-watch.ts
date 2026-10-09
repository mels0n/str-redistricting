import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { affectedBy, diffSources, hashRemote, probeSource, SourcesSchema, type Source } from '../features/census-watch/index.js';
import { boundaryUrl } from '../features/publish/index.js';
import { blocksUrl } from '../entities/census-block/index.js';
import { CENSUS_SHA256, parseCensusWatchConfig } from '../shared/config/index.js';
import { DataError, exitCodeFor } from '../shared/errors/index.js';

// `census:watch --record` HEADs every file in config/census-sha256.json and writes config/census-sources.json.
// `census:watch --check --report <path>` HEADs them again and writes {changed, unknown, states, display} to <path>;
// files the headers cannot settle are streamed to a temp dir and compared with the pinned hash. Never edits a config.

const CONCURRENCY = 4;

/** Where Census serves a manifest file from. A name the app does not recognise stops the run rather than being skipped. */
function sourceUrl(file: string): string {
  const block = /^tl_2020_(\d{2})_tabblock20\.zip$/.exec(file)?.[1];
  if (block !== undefined) return blocksUrl(block);
  if (/^cb_\d{4}_us_[a-z0-9_]+\.zip$/.test(file)) return boundaryUrl(file.slice(0, -'.zip'.length));
  throw new DataError(`${file}: no known Census address for this manifest entry`);
}

async function mapLimited<T, R>(items: readonly T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  }));
  return out;
}

const sortedJson = (o: Readonly<Record<string, unknown>>): string =>
  JSON.stringify(Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))), null, 2) + '\n';

async function probeAll(files: readonly string[]): Promise<{ sources: Record<string, Source>; failed: string[] }> {
  const sources: Record<string, Source> = {};
  const failed: string[] = [];
  await mapLimited(files, async (file) => {
    try {
      sources[file] = await probeSource(sourceUrl(file));
    } catch (err) {
      failed.push(file);
      console.error(`${file}: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
  return { sources, failed: failed.sort() };
}

async function main(): Promise<void> {
  const cfg = parseCensusWatchConfig(process.argv.slice(2));
  const files = Object.keys(CENSUS_SHA256).sort();
  const sourcesPath = join(cfg.configDir, 'census-sources.json');
  const { sources, failed } = await probeAll(files);

  if (cfg.mode === 'record') {
    await writeFile(sourcesPath, sortedJson(sources), 'utf8');
    const bare = Object.keys(sources).filter((f) => sources[f]!.etag === undefined && sources[f]!.lastModified === undefined && sources[f]!.contentLength === undefined);
    console.log(JSON.stringify({ recorded: Object.keys(sources).length, failed, withoutHeaders: bare }));
    if (failed.length > 0) process.exitCode = 1;
    return;
  }

  const recorded = SourcesSchema.parse(JSON.parse(await readFile(sourcesPath, 'utf8').then((t) => t.replace(/^\uFEFF/, ''))));
  // A file the probe could not reach is not "unchanged": it goes to the hash check like any other undecided file.
  const diff = diffSources(recorded, sources);
  const changed = new Set(diff.changed);
  const unknown: string[] = [];
  const undecided = [...new Set([...diff.unknown.filter((f) => f in CENSUS_SHA256), ...failed])].sort();
  await mapLimited(undecided, async (file) => {
    try {
      const sha = await hashRemote(sourceUrl(file), file);
      if (sha !== CENSUS_SHA256[file]) changed.add(file);
    } catch (err) {
      unknown.push(file);
      console.error(`${file}: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
  const list = [...changed].sort();
  await writeFile(cfg.report, JSON.stringify({ changed: list, unknown: unknown.sort(), ...affectedBy(list) }) + '\n', 'utf8');
  console.log(JSON.stringify({ changed: list.length, unknown: unknown.length }));
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : 'census:watch failed');
  process.exit(exitCodeFor(err));
});
