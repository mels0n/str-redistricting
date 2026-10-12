import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { LegislativeChamber } from '../../entities/legislative-boundary/index.js';

/** The config files a legislative bump rewrites before it knows the new files are good. */
export const LEGISLATIVE_CONFIG_FILES: readonly string[] = ['enacted.json', 'census-sha256.json', 'census-sources.json', 'legislative-districts.json'];

/**
 * Run `fn`; when it throws, put every file in `names` (under `configDir`) back as it was before and rethrow. A file that
 * did not exist is removed again. A failed update never leaves a half-applied config behind.
 */
export async function withConfigRestored<T>(configDir: string, names: readonly string[], fn: () => Promise<T>): Promise<T> {
  const saved = new Map<string, Buffer | null>();
  for (const name of names) {
    saved.set(name, await readFile(join(configDir, name)).catch(() => null));
  }
  try {
    return await fn();
  } catch (err) {
    for (const [name, body] of saved) {
      const path = join(configDir, name);
      if (body === null) await rm(path, { force: true });
      else {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, body);
      }
    }
    throw err;
  }
}

/**
 * Every bump moves the input revision and maps release, so every published chamber is restamped, not just the one whose
 * overlay changed. `publish` runs the overlay publisher for one chamber (none is the Federal House); the Federal House
 * goes first and the versions file moves with the last run, once no chamber carries an older stamp.
 */
export function publishAllChambers(publish: (chamber?: 'state-house' | 'state-senate') => void): void {
  publish();
  publish('state-house');
  publish('state-senate');
}

type Counts = Readonly<Record<string, Readonly<Partial<Record<LegislativeChamber, number>>>>>;

/** `ST:state-house` / `ST:state-senate` for every chamber whose district count differs, restricted to the ids in `among`. */
export function fixturesWithChangedCounts(before: Counts, after: Counts, among: readonly string[]): string[] {
  return among
    .filter((id) => {
      const [abbr = '', chamber] = id.split(':');
      if (chamber !== 'state-house' && chamber !== 'state-senate') return false;
      const was = before[abbr]?.[chamber];
      const now = after[abbr]?.[chamber];
      return was !== undefined && now !== undefined && was !== now;
    })
    .sort();
}
