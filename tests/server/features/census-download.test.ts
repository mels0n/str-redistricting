import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadStateBlocks } from '../../../src/server/entities/census-block/index.js';
import { ChecksumError, DataError, DownloadError } from '../../../src/server/shared/errors/index.js';
import { downloadCached } from '../../../src/server/shared/http/index.js';

const sha = (s: string): string => createHash('sha256').update(s).digest('hex');
const BODY = 'census bytes';
const GOOD = sha(BODY);
const state = { abbr: 'RI', fips: '44', name: 'Rhode Island', seats: 2 };

let dir: string;
let path: string;
let sleeps: number[];
const sleep = async (ms: number): Promise<void> => {
  sleeps.push(ms);
};
const ok = (body = BODY, headers: Record<string, string> = {}): Response => new Response(body, { status: 200, headers });
const run = (fetchFn: typeof fetch, sha256 = GOOD) => downloadCached('https://example.test/f.zip', path, 'f', sha256, { fetchFn, sleep });

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'census-dl-'));
  path = join(dir, 'f.zip');
  sleeps = [];
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('downloadCached retries', () => {
  it('retries a 503 with exponential backoff, then succeeds', async () => {
    const f = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('x', { status: 503 }))
      .mockResolvedValueOnce(new Response('x', { status: 429 }))
      .mockResolvedValueOnce(ok());
    await run(f);
    expect(f).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([2000, 4000]);
    expect(await readFile(path, 'utf8')).toBe(BODY);
    expect(existsSync(`${path}.part`)).toBe(false);
  });
  it('gives up after three retries and names the file and attempts', async () => {
    const f = vi.fn<typeof fetch>(async () => new Response('x', { status: 500 }));
    const err = await run(f).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DownloadError);
    expect((err as Error).message).toContain('download failed for f after 4 attempts');
    expect(f).toHaveBeenCalledTimes(4);
    expect(sleeps).toEqual([2000, 4000, 8000]);
    expect(existsSync(path)).toBe(false);
    expect(existsSync(`${path}.part`)).toBe(false);
  });
  it('does not retry a 404', async () => {
    const f = vi.fn<typeof fetch>(async () => new Response('x', { status: 404 }));
    const err = await run(f).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DownloadError);
    expect((err as DownloadError).status).toBe(404);
    expect(f).toHaveBeenCalledTimes(1);
    expect(sleeps).toEqual([]);
  });
  it('retries a timeout', async () => {
    const f = vi.fn<typeof fetch>()
      .mockRejectedValueOnce(new DOMException('The operation timed out', 'TimeoutError'))
      .mockResolvedValueOnce(ok());
    await run(f);
    expect(f).toHaveBeenCalledTimes(2);
  });
  it('aborts a stalled body after the idle timeout and retries', async () => {
    // Like a real fetch body, the stream errors when the request's signal aborts.
    const stalled = async (_url: unknown, init?: RequestInit): Promise<Response> => new Response(
      new ReadableStream<Uint8Array>({ start: (c) => init?.signal?.addEventListener('abort', () => c.error(init.signal?.reason)) }),
      { status: 200 },
    );
    const f = vi.fn<typeof fetch>()
      .mockImplementationOnce(stalled)
      .mockResolvedValueOnce(ok());
    await downloadCached('https://example.test/f.zip', path, 'f', GOOD, { fetchFn: f, sleep, stallMs: 20 });
    expect(f).toHaveBeenCalledTimes(2);
  });
  it('retries a truncated body', async () => {
    const f = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(ok('abc', { 'content-length': '10' }))
      .mockResolvedValueOnce(ok());
    await run(f);
    expect(f).toHaveBeenCalledTimes(2);
    expect(await readFile(path, 'utf8')).toBe(BODY);
  });
  it('ignores a leftover .part file', async () => {
    await writeFile(`${path}.part`, 'garbage');
    await run(vi.fn<typeof fetch>(async () => ok()));
    expect(await readFile(path, 'utf8')).toBe(BODY);
  });
});

describe('downloadCached integrity', () => {
  it('verifies a good download', async () => {
    expect(await run(vi.fn<typeof fetch>(async () => ok()))).toBe(path);
    expect(await readFile(path, 'utf8')).toBe(BODY);
  });
  it('fails a hash mismatch on a fresh download, without retrying, and leaves no cache file', async () => {
    const f = vi.fn<typeof fetch>(async () => ok('different'));
    const err = await run(f).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ChecksumError);
    const msg = (err as Error).message;
    expect(msg).toContain('f.zip: sha256 does not match the pinned value');
    expect(msg).toContain('just downloaded');
    expect(msg).toContain('config/census-sha256.json');
    expect(msg).not.toContain('Delete');
    expect(f).toHaveBeenCalledTimes(1);
    expect(existsSync(path)).toBe(false);
    expect(existsSync(`${path}.part`)).toBe(false);
  });
  it('accepts a cached file that matches without fetching', async () => {
    await writeFile(path, BODY);
    const f = vi.fn<typeof fetch>();
    await run(f);
    expect(f).not.toHaveBeenCalled();
  });
  it('fails a cached file that does not match, with the remedy in the message', async () => {
    await writeFile(path, 'corrupt');
    const f = vi.fn<typeof fetch>();
    const err = await run(f).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ChecksumError);
    const msg = (err as Error).message;
    expect(msg).toContain('f.zip: sha256 does not match the pinned value');
    expect(msg).toContain('The cached file is corrupt or the Census Bureau reissued it');
    expect(msg).toContain(`Delete ${path} to download it again`);
    expect(msg).toContain('update the manifest (this changes the maps)');
    expect(f).not.toHaveBeenCalled();
    expect(await readFile(path, 'utf8')).toBe('corrupt');
  });
});

describe('census file lookup', () => {
  it('fails a file that is not in the manifest, before touching the network', async () => {
    const f = vi.fn(async () => ok());
    vi.stubGlobal('fetch', f);
    try {
      await expect(loadStateBlocks({ ...state, fips: '99' }, dir)).rejects.toThrow(/not in the pinned Census manifest/);
      expect(f).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('fails a cached state zip that does not match the pinned hash', async () => {
    await writeFile(join(dir, 'tl_2020_44_tabblock20.zip'), 'not the real zip');
    await expect(loadStateBlocks(state, dir)).rejects.toThrow(DataError);
    await expect(loadStateBlocks(state, dir)).rejects.toThrow(/sha256 does not match the pinned value/);
  });
});
