import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
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
const partFiles = async (): Promise<string[]> => (await readdir(dir)).filter((f) => f.endsWith('.part'));
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
    expect(await partFiles()).toEqual([]);
  });
  it('gives up after three retries and names the file and attempts', async () => {
    const f = vi.fn<typeof fetch>(async () => new Response('x', { status: 500 }));
    const err = await run(f).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DownloadError);
    expect((err as Error).message).toContain('download failed for f after 4 attempts');
    expect(f).toHaveBeenCalledTimes(4);
    expect(sleeps).toEqual([2000, 4000, 8000]);
    expect(existsSync(path)).toBe(false);
    expect(await partFiles()).toEqual([]);
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
  it('gives each attempt a part name of its own, so concurrent downloads of one file do not collide', async () => {
    // Both runs must be in flight (part file open, body not yet streamed) before either goes on. Each stub then waits
    // for its own gate, and the gates open one after the other so the two renames never race (Windows refuses that
    // with EPERM, which would send the loser round again and hide what this test is about).
    const gates: Array<() => void> = [];
    let inFlight: string[] = [];
    let arrived!: () => void;
    const bothArrived = new Promise<void>((r) => {
      arrived = r;
      setTimeout(r, 500); // a collision fails the assertions below instead of hanging the test
    });
    const stub = (): Promise<Response> => {
      const gate = new Promise<void>((r) => gates.push(r));
      if (gates.length === 2) arrived();
      return gate.then(() => ok());
    };
    const a = vi.fn<typeof fetch>(stub);
    const b = vi.fn<typeof fetch>(stub);
    const runs = Promise.all([run(a), run(b)]);
    await bothArrived;
    inFlight = await partFiles();
    gates[0]?.();
    // Whichever run arrived first finishes (renames its part into place) before the other is let go.
    for (let i = 0; i < 200 && (await partFiles()).length > 1; i++) await new Promise((r) => setTimeout(r, 5));
    gates[1]?.();
    await runs;
    expect(inFlight).toHaveLength(2);
    expect(new Set(inFlight).size).toBe(2);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    expect(await readFile(path, 'utf8')).toBe(BODY);
    expect(await partFiles()).toEqual([]);
  });
  it('cancels the body of a failed response', async () => {
    const cancel = vi.fn();
    const f = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(new ReadableStream({ cancel }), { status: 404 }));
    await expect(run(f)).rejects.toThrow(DownloadError);
    expect(cancel).toHaveBeenCalled();
  });
  it('leaves a stray part file of another run alone', async () => {
    const stray = `${path}.99999.00000000-0000-0000-0000-000000000000.part`;
    await writeFile(stray, 'garbage');
    await run(vi.fn<typeof fetch>(async () => ok()));
    expect(await readFile(path, 'utf8')).toBe(BODY);
    expect(await readFile(stray, 'utf8')).toBe('garbage');
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
    expect(msg).toContain('f.zip: sha256 differs from config/census-sha256.json');
    expect(msg).toContain('just downloaded');
    expect(msg).toContain('npm run release');
    expect(msg).not.toContain('Delete');
    expect(f).toHaveBeenCalledTimes(1);
    expect(existsSync(path)).toBe(false);
    expect(await partFiles()).toEqual([]);
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
    expect(msg).toContain('f.zip: sha256 differs from config/census-sha256.json');
    expect(msg).toContain('npm run release');
    expect(msg).toContain('The cached file is corrupt or the Census Bureau reissued it');
    expect(msg).toContain(`Delete ${path} to download it again`);
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
    await expect(loadStateBlocks(state, dir)).rejects.toThrow(/sha256 differs from config\/census-sha256\.json/);
  });
});
