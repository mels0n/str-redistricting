import { randomBytes } from 'node:crypto';
import { rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { DataError } from '../../shared/errors/index.js';

/*
 * Several publish-data runs (one per chamber, say) may share a public directory. Every file is replaced through a
 * rename, so a reader never sees half a file, and the files that describe the whole directory (index.json,
 * versions.json) are rebuilt by one run at a time under a lock file.
 */

const RENAME_RETRIES = 20;

/** Windows refuses a rename over a file another process has open or is replacing at that moment; it clears within milliseconds. */
async function renameOver(from: string, to: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await rename(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (attempt >= RENAME_RETRIES || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) throw err;
      await delay(10 * attempt);
    }
  }
}

/** Write through a temporary file in the same folder, then rename it over the destination. */
export async function writeAtomic(path: string, body: string | Uint8Array): Promise<void> {
  // Unique per process and per call, so two writers never share a temporary file.
  const tmp = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.part`;
  try {
    await writeFile(tmp, body);
    await renameOver(tmp, path);
  } finally {
    await rm(tmp, { force: true });
  }
}

export const LOCK_FILE = '.publish.lock';

export interface LockOptions {
  /** A lock older than this is taken to belong to a run that died, and is removed. */
  readonly staleMs?: number;
  /** The longest wait for a lock held by a live run, after which the run fails. */
  readonly timeoutMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => number;
}

const STALE_MS = 10 * 60_000;
const BACKOFF_START_MS = 25;
const BACKOFF_MAX_MS = 1_000;

/** Run `fn` holding the exclusive lock of `dir`; the lock is released whether `fn` returns or throws. */
export async function withDirLock<T>(dir: string, fn: () => Promise<T>, opts: LockOptions = {}): Promise<T> {
  const staleMs = opts.staleMs ?? STALE_MS;
  const timeoutMs = opts.timeoutMs ?? staleMs + 60_000;
  const sleep = opts.sleep ?? ((ms: number) => delay(ms));
  const now = opts.now ?? Date.now;
  const lock = join(dir, LOCK_FILE);
  const started = now();
  let wait = BACKOFF_START_MS;
  for (;;) {
    try {
      await writeFile(lock, `${process.pid}\n`, { flag: 'wx' });
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
    const age = await stat(lock).then((s) => now() - s.mtimeMs, () => undefined);
    if (age !== undefined && age > staleMs) {
      await rm(lock, { force: true });
      continue;
    }
    if (now() - started > timeoutMs) throw new DataError(`${lock}: still held after ${Math.round(timeoutMs / 1000)}s; another publish-data run is writing the index`);
    await sleep(wait);
    wait = Math.min(wait * 2, BACKOFF_MAX_MS);
  }
  try {
    return await fn();
  } finally {
    await rm(lock, { force: true });
  }
}

/** Read and parse a JSON file written by a concurrent run; a failed read or parse is retried once after a short wait. */
export async function readJsonRetrying(read: () => Promise<unknown>, sleep: (ms: number) => Promise<void> = (ms) => delay(ms)): Promise<unknown> {
  try {
    return await read();
  } catch {
    await sleep(100);
    return read();
  }
}
