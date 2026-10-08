import { setTimeout as delay } from 'node:timers/promises';
import { enactedFileName, parseEnactedFileName, type EnactedConfig } from '../../shared/config/index.js';
import { ConfigError, DownloadError } from '../../shared/errors/index.js';

/** Retries after the first probe of one URL; waits double each time. */
export const PROBE_RETRIES = 3;
export const PROBE_BACKOFF_MS = 2_000;

export interface Candidate {
  readonly file: string;
  readonly congress: number;
  readonly year: number;
}

/**
 * The files a newer enacted-districts release could be, in order of preference: the next Congress first (newest
 * year first), then newer releases of the pinned Congress (newest first). The Census Bureau names a release for
 * the year it is made, so a release can be at most one year ahead of `nowYear`.
 */
export function candidateFiles(current: Pick<EnactedConfig, 'congress' | 'file'>, nowYear: number): Candidate[] {
  const pinned = parseEnactedFileName(current.file);
  if (pinned === null) throw new ConfigError(`${current.file} is not an enacted-districts file name`);
  const out: Candidate[] = [];
  const years = (from: number): number[] => Array.from({ length: Math.max(0, nowYear + 1 - from + 1) }, (_, i) => nowYear + 1 - i);
  for (const year of years(pinned.year)) out.push({ file: enactedFileName(year, current.congress + 1), congress: current.congress + 1, year });
  for (const year of years(pinned.year + 1)) out.push({ file: enactedFileName(year, current.congress), congress: current.congress, year });
  return out;
}

export interface ProbeOptions {
  readonly fetchFn?: typeof fetch;
  readonly sleep?: (ms: number) => Promise<void>;
}

const NOT_ALLOWED = new Set([405, 501]);
const isRetryableStatus = (status: number): boolean => status >= 500 || status === 429;

/** A page of HTML where a zip should be is a soft 404, not a release. */
const looksLikeFile = (res: Response): boolean => !(res.headers.get('content-type') ?? '').toLowerCase().startsWith('text/html');

/** One request; returns true (served), false (404) or a status to retry or to fall back on. */
async function probeOnce(url: string, method: 'HEAD' | 'GET', fetchFn: typeof fetch): Promise<boolean | { status: number }> {
  const res = await fetchFn(url, { method, redirect: 'follow', ...(method === 'GET' ? { headers: { Range: 'bytes=0-0' } } : {}) });
  // The body is never wanted; a server that ignores Range would otherwise stream the whole file.
  await res.body?.cancel().catch(() => undefined);
  if (res.status === 404) return false;
  if (res.status >= 200 && res.status < 300) return looksLikeFile(res);
  return { status: res.status };
}

/**
 * Whether the Census Bureau serves `url`. Uses HEAD and falls back to a one-byte ranged GET when HEAD is not
 * supported. 404 means absent. Network errors, 5xx and 429 are retried with backoff, then fail; any other status
 * is a failure too, so an unexpected answer never reads as "no release".
 */
export async function isServed(url: string, opts: ProbeOptions = {}): Promise<boolean> {
  const fetchFn = opts.fetchFn ?? ((input, init) => fetch(input, init));
  const sleep = opts.sleep ?? ((ms: number) => delay(ms));
  let method: 'HEAD' | 'GET' = 'HEAD';
  let backoff = PROBE_BACKOFF_MS;
  for (let attempt = 1; ; attempt++) {
    let outcome: boolean | { status: number } | { error: string };
    try {
      outcome = await probeOnce(url, method, fetchFn);
    } catch (err) {
      outcome = { error: err instanceof Error ? err.message : String(err) };
    }
    if (typeof outcome === 'boolean') return outcome;
    if ('status' in outcome && method === 'HEAD' && NOT_ALLOWED.has(outcome.status)) {
      method = 'GET';
      attempt--;
      continue;
    }
    const retryable = 'error' in outcome || isRetryableStatus(outcome.status);
    const reason = 'error' in outcome ? outcome.error : `HTTP ${outcome.status}`;
    if (!retryable) throw new DownloadError(`probe of ${url} failed: ${reason}`, 'status' in outcome ? outcome.status : undefined);
    if (attempt > PROBE_RETRIES) {
      throw new DownloadError(`probe of ${url} failed after ${attempt} attempts: ${reason}`, 'status' in outcome ? outcome.status : undefined);
    }
    await sleep(backoff);
    backoff *= 2;
  }
}

export type Detection =
  | { readonly update: false }
  | { readonly update: true; readonly file: string; readonly congress: number; readonly year: number; readonly url: string };

/** Probe every candidate and report the most preferred one that is served, or that there is nothing new. */
export async function detectUpdate(
  current: Pick<EnactedConfig, 'congress' | 'file'>,
  nowYear: number,
  urlFor: (file: string) => string,
  opts: ProbeOptions = {},
): Promise<Detection> {
  for (const c of candidateFiles(current, nowYear)) {
    const url = urlFor(c.file);
    if (await isServed(url, opts)) return { update: true, file: c.file, congress: c.congress, year: c.year, url };
  }
  return { update: false };
}
