import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { STATES } from '../../shared/apportionment/index.js';
import { REPS_HOSTS } from '../../shared/config/reps-hosts.js';
import { DataError } from '../../shared/errors/index.js';
import { adoptIfAccepted, downloadForPinning, sha256File, type DownloadOptions } from '../../shared/http/index.js';

export const LEGISLATORS_FILE = 'legislators-current.json';
export const SOCIAL_FILE = 'legislators-social-media.json';
/** Open States' file for a state, e.g. `co.csv`. */
export const openStatesFile = (abbr: string): string => `${abbr.toLowerCase()}.csv`;

/** config/reps-sources.json: file name to where it is served and the sha256 it must have. */
export const RepsSourcesSchema = z.record(z.string().min(1), z.object({ url: z.string().url(), sha256: z.string().regex(/^[0-9a-f]{64}$/) }));
export type RepsSources = z.infer<typeof RepsSourcesSchema>;

/** Every file the published rep data is built from, with its address. */
export function repsSourceList(): { name: string; url: string }[] {
  const congress = 'https://unitedstates.github.io/congress-legislators/';
  return [
    { name: LEGISLATORS_FILE, url: `${congress}${LEGISLATORS_FILE}` },
    { name: SOCIAL_FILE, url: `${congress}${SOCIAL_FILE}` },
    ...STATES.map((s) => ({ name: openStatesFile(s.abbr), url: `https://data.openstates.org/people/current/${openStatesFile(s.abbr)}` })),
  ];
}

const withHosts = (opts: DownloadOptions): DownloadOptions => ({ ...opts, allowedHosts: REPS_HOSTS });

/** Read config/reps-sources.json. */
export async function readRepsSources(configDir: string): Promise<RepsSources> {
  return RepsSourcesSchema.parse(JSON.parse((await readFile(join(configDir, 'reps-sources.json'), 'utf8')).replace(/^﻿/, '')) as unknown);
}

function mismatch(name: string, expected: string, actual: string): DataError {
  return new DataError(
    `${name}: sha256 ${actual} differs from ${expected} in config/reps-sources.json. The source changed upstream, or the cached copy is corrupt. ` +
      'Delete the cached copy to fetch it again; if the source really changed, run reps:pin to pin the new file deliberately.',
  );
}

/**
 * The text of one source, checked against its pinned hash. A cached copy is used when there is one; otherwise the
 * file is fetched and kept only if its hash matches. A mismatch stops the run and leaves any cached file alone.
 */
export async function readVerified(name: string, source: { url: string; sha256: string }, cacheDir: string, opts: DownloadOptions = {}): Promise<string> {
  const path = join(cacheDir, name);
  if (existsSync(path)) {
    const actual = await sha256File(path);
    if (actual !== source.sha256) throw mismatch(name, source.sha256, actual);
  } else {
    const fresh = await downloadForPinning(source.url, path, name, withHosts(opts));
    await adoptIfAccepted(fresh.path, path, async () => {
      if (fresh.sha256 !== source.sha256) throw mismatch(name, source.sha256, fresh.sha256);
    });
  }
  return readFile(path, 'utf8');
}

const sortedJson = (o: Readonly<Record<string, unknown>>): string =>
  `${JSON.stringify(Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))), null, 2)}\n`;

const CONCURRENCY = 4;

/** Download every source (always fresh, never trusting the cache), keep the files, and write their hashes to config/reps-sources.json. */
export async function pinRepsSources(configDir: string, cacheDir: string, opts: DownloadOptions = {}): Promise<number> {
  const jobs = repsSourceList();
  const pins: RepsSources = {};
  let next = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (next < jobs.length) {
      const { name, url } = jobs[next++]!;
      const path = join(cacheDir, name);
      const fresh = await downloadForPinning(url, path, name, withHosts(opts));
      await adoptIfAccepted(fresh.path, path, async () => undefined);
      pins[name] = { url, sha256: fresh.sha256 };
    }
  }));
  await writeFile(join(configDir, 'reps-sources.json'), sortedJson(RepsSourcesSchema.parse(pins)), 'utf8');
  return jobs.length;
}
