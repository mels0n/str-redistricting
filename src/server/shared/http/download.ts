import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { CENSUS_HOSTS } from '../config/index.js';
import { ChecksumError, DownloadError, DownloadRefusedError } from '../errors/index.js';

/** A download is abandoned when no byte (headers included) arrives for this long. Block zips run to about 260 MB. */
export const STALL_TIMEOUT_MS = 60_000;
/** Hard ceiling for one attempt however steadily bytes arrive. */
export const TOTAL_TIMEOUT_MS = 15 * 60_000;
/** Retries after the first attempt; waits double each time (2 s, 4 s, 8 s). */
export const MAX_RETRIES = 3;
export const BACKOFF_BASE_MS = 2_000;
/** Redirects followed for one attempt; more than this is refused. */
export const MAX_REDIRECTS = 5;
/**
 * No Census file may exceed 1 GiB. The largest real one (the Texas block file) is 746 MB, so this leaves about 40%
 * headroom for a reissue while stopping a wrong or hostile response long before it fills the disk.
 */
export const MAX_DOWNLOAD_BYTES = 1_073_741_824;

export interface DownloadOptions {
  readonly fetchFn?: typeof fetch;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly stallMs?: number;
  readonly totalMs?: number;
  /** Hosts a download may come from, https only; defaults to the hosts in config/census-sources.json. */
  readonly allowedHosts?: ReadonlySet<string>;
  /** Largest body accepted; defaults to MAX_DOWNLOAD_BYTES. */
  readonly maxBytes?: number;
}

/** Refuse an address that is not https on an allowed host. */
function assertAllowedUrl(url: string, label: string, hosts: ReadonlySet<string>): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new DownloadRefusedError(`download for ${label} refused: not a valid address`);
  }
  if (parsed.protocol !== 'https:' || !hosts.has(parsed.hostname)) {
    throw new DownloadRefusedError(`download for ${label} refused: ${parsed.protocol}//${parsed.hostname} is not an allowed Census host`);
  }
}

/** SHA-256 of a file, streamed so a 260 MB archive is never held in memory. */
export async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

/** Network errors, timeouts, truncated bodies, HTTP 5xx and 429 are worth another try; other 4xx and hash mismatches are not. */
function isRetryable(err: unknown): boolean {
  if (err instanceof ChecksumError || err instanceof DownloadRefusedError) return false;
  if (err instanceof DownloadError) return err.status === undefined || err.status >= 500 || err.status === 429;
  return true;
}

/** One attempt: stream the body into `part` (a name no other attempt shares), enforcing the stall and total timeouts, content-length and the pinned hash. */
async function fetchToPart(url: string, path: string, part: string, label: string, sha256: string | null, o: Required<DownloadOptions>): Promise<string> {
  const stall = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const arm = (): void => {
    clearTimeout(timer);
    timer = setTimeout(() => stall.abort(new Error(`no data for ${o.stallMs} ms`)), o.stallMs);
  };
  const signal = AbortSignal.any([stall.signal, AbortSignal.timeout(o.totalMs)]);
  assertAllowedUrl(url, label, o.allowedHosts);
  const file = await open(part, 'wx');
  arm();
  try {
    // Redirects are followed here, one hop at a time, so an address off the allowlist is refused before it is requested.
    let current = url;
    let res = await o.fetchFn(current, { signal, redirect: 'manual' });
    for (let hops = 0; res.status >= 300 && res.status < 400 && res.headers.has('location'); hops++) {
      await res.body?.cancel().catch(() => undefined);
      if (hops >= MAX_REDIRECTS) throw new DownloadRefusedError(`download for ${label} refused: more than ${MAX_REDIRECTS} redirects`);
      try {
        current = new URL(res.headers.get('location')!, current).toString();
      } catch {
        throw new DownloadRefusedError(`download for ${label} refused: redirect to an invalid address`);
      }
      assertAllowedUrl(current, label, o.allowedHosts);
      res = await o.fetchFn(current, { signal, redirect: 'manual' });
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      throw new DownloadError(`download failed for ${label}: HTTP ${res.status}`, res.status);
    }
    if (res.body === null) throw new DownloadError(`download for ${label} had no body`);
    const declared = res.headers.get('content-length');
    if (declared !== null && Number(declared) > o.maxBytes) {
      await res.body.cancel().catch(() => undefined);
      throw new DownloadRefusedError(`download for ${label} refused: ${declared} bytes is over the ${o.maxBytes} byte limit`);
    }
    const hash = createHash('sha256');
    let size = 0;
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      arm();
      hash.update(value);
      size += value.length;
      if (size > o.maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new DownloadRefusedError(`download for ${label} refused: more than ${o.maxBytes} bytes`);
      }
      await file.write(value);
    }
    const expected = res.headers.get('content-length');
    if (expected !== null && Number(expected) !== size) {
      throw new DownloadError(`download for ${label} truncated: expected ${expected} bytes, got ${size}`);
    }
    const digest = hash.digest('hex');
    if (sha256 !== null && digest !== sha256) throw new ChecksumError(basename(path), path, 'fresh');
    return digest;
  } finally {
    clearTimeout(timer);
    await file.close();
  }
}

/** Download to `path` with retries and backoff, checking the body against `sha256` unless it is null; returns the body's SHA-256. */
async function fetchWithRetries(url: string, path: string, label: string, sha256: string | null, opts: DownloadOptions): Promise<string> {
  const o: Required<DownloadOptions> = {
    fetchFn: opts.fetchFn ?? ((input, init) => fetch(input, init)),
    sleep: opts.sleep ?? ((ms) => delay(ms)),
    stallMs: opts.stallMs ?? STALL_TIMEOUT_MS,
    totalMs: opts.totalMs ?? TOTAL_TIMEOUT_MS,
    allowedHosts: opts.allowedHosts ?? CENSUS_HOSTS,
    maxBytes: opts.maxBytes ?? MAX_DOWNLOAD_BYTES,
  };
  await mkdir(dirname(path), { recursive: true });
  let backoff = BACKOFF_BASE_MS;
  for (let attempt = 1; ; attempt++) {
    // A name of its own per attempt, so two runs downloading the same file never write into one another's part.
    const part = `${path}.${process.pid}.${randomUUID()}.part`;
    try {
      const digest = await fetchToPart(url, path, part, label, sha256, o);
      await rename(part, path);
      return digest;
    } catch (err) {
      // A cleanup failure (EBUSY on Windows) must not replace the real error.
      try {
        await rm(part, { force: true });
      } catch {
        // Left behind; the next attempt uses a different name.
      }
      if (!isRetryable(err)) throw err;
      const reason = err instanceof Error ? err.message : String(err);
      if (attempt > MAX_RETRIES) {
        throw new DownloadError(`download failed for ${label} after ${attempt} attempts: ${reason}`, err instanceof DownloadError ? err.status : undefined);
      }
      await o.sleep(backoff);
      backoff *= 2;
    }
  }
}

/**
 * Fetch `url` to `path` unless it is already there, and check the file against its pinned `sha256` either way.
 * The body is written to a part file beside it and renamed only once it is complete and verified, so neither a partial
 * nor a wrong download ever looks like a cached file. A cached file that fails the check is left in place for
 * the maintainer to inspect, and the run stops.
 */
export async function downloadCached(url: string, path: string, label: string, sha256: string, opts: DownloadOptions = {}): Promise<string> {
  if (existsSync(path)) {
    if ((await sha256File(path)) !== sha256) throw new ChecksumError(basename(path), path);
    return path;
  }
  await fetchWithRetries(url, path, label, sha256, opts);
  return path;
}

/**
 * The same download for a file that is not pinned yet (a new Census release the maintainer is about to adopt):
 * no hash is checked, and the file's SHA-256 is returned for the manifest. Every later read goes through
 * `downloadCached`, which checks the cached file against that hash.
 */
export async function downloadForPinning(url: string, path: string, label: string, opts: DownloadOptions = {}): Promise<{ path: string; sha256: string }> {
  if (existsSync(path)) return { path, sha256: await sha256File(path) };
  return { path, sha256: await fetchWithRetries(url, path, label, null, opts) };
}
