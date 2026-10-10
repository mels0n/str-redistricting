import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { DownloadError } from '../../shared/errors/index.js';
import { HEAD_TIMEOUT_MS, downloadForPinning, type DownloadOptions } from '../../shared/http/index.js';
import type { Source } from './diff.js';

const HEAD_RETRIES = 2;
const HEAD_BACKOFF_MS = 2_000;

export interface ProbeOptions {
  readonly fetchFn?: typeof fetch;
  readonly sleep?: (ms: number) => Promise<void>;
}

/** HEAD one file and keep the three headers that identify its bytes; retries network errors, 5xx and 429. */
export async function probeSource(url: string, opts: ProbeOptions = {}): Promise<Source> {
  const fetchFn = opts.fetchFn ?? ((input, init) => fetch(input, init));
  const sleep = opts.sleep ?? ((ms: number) => delay(ms));
  let backoff = HEAD_BACKOFF_MS;
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetchFn(url, { method: 'HEAD', signal: AbortSignal.timeout(HEAD_TIMEOUT_MS) });
      if (!res.ok) throw new DownloadError(`HEAD ${url}: HTTP ${res.status}`, res.status);
      const etag = res.headers.get('etag');
      const lastModified = res.headers.get('last-modified');
      const length = res.headers.get('content-length');
      const contentLength = length !== null && /^\d+$/.test(length) ? Number(length) : undefined;
      return {
        url,
        ...(etag !== null && etag !== '' ? { etag } : {}),
        ...(lastModified !== null && lastModified !== '' ? { lastModified } : {}),
        ...(contentLength !== undefined ? { contentLength } : {}),
      };
    } catch (err) {
      const retryable = !(err instanceof DownloadError) || err.status === undefined || err.status >= 500 || err.status === 429;
      if (!retryable || attempt >= HEAD_RETRIES) throw err;
      await sleep(backoff);
      backoff *= 2;
    }
  }
}

export interface HashRemoteOptions extends DownloadOptions {
  /** Directory to make the scratch folder in; defaults to the OS temp dir. */
  readonly tmpRoot?: string;
}

/** SHA-256 of a remote file. It is streamed to a fresh temp directory, which is deleted whether or not the download worked. */
export async function hashRemote(url: string, fileName: string, opts: HashRemoteOptions = {}): Promise<string> {
  const dir = await mkdtemp(join(opts.tmpRoot ?? tmpdir(), 'census-watch-'));
  try {
    return (await downloadForPinning(url, join(dir, fileName), fileName, opts)).sha256;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
