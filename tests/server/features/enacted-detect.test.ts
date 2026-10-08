import { describe, expect, it, vi } from 'vitest';
import { candidateFiles, detectUpdate, isServed } from '../../../src/server/features/enacted/index.js';
import { DownloadError } from '../../../src/server/shared/errors/index.js';

const URL_OF = (file: string): string => `https://example.test/${file}.zip`;
const pinned = { congress: 119, file: 'cb_2025_us_cd119_500k' };

/** A fake Census server: serves exactly the named files, answers HEAD (unless `noHead`) and ranged GET. */
function server(served: readonly string[], opts: { noHead?: boolean } = {}): ReturnType<typeof vi.fn<typeof fetch>> {
  return vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (method === 'HEAD' && opts.noHead) return new Response(null, { status: 405 });
    const present = served.some((f) => url === URL_OF(f));
    if (!present) return new Response('<html>not found</html>', { status: 404, headers: { 'content-type': 'text/html' } });
    return new Response(method === 'HEAD' ? null : 'x', { status: method === 'GET' ? 206 : 200, headers: { 'content-type': 'application/zip' } });
  });
}
const noSleep = async (): Promise<void> => undefined;

describe('candidateFiles', () => {
  it('lists the next Congress first, then newer releases of the pinned one, newest year first', () => {
    expect(candidateFiles(pinned, 2026).map((c) => c.file)).toEqual([
      'cb_2027_us_cd120_500k', 'cb_2026_us_cd120_500k', 'cb_2025_us_cd120_500k',
      'cb_2027_us_cd119_500k', 'cb_2026_us_cd119_500k',
    ]);
  });
  it('never offers the pinned file itself or an older year of the pinned Congress', () => {
    const files = candidateFiles(pinned, 2025).map((c) => c.file);
    expect(files).not.toContain('cb_2025_us_cd119_500k');
    expect(files).toEqual(['cb_2026_us_cd120_500k', 'cb_2025_us_cd120_500k', 'cb_2026_us_cd119_500k']);
  });
  it('reaches at most one year past the current year', () => {
    expect(candidateFiles(pinned, 2030).map((c) => c.year)).toContain(2031);
    expect(candidateFiles(pinned, 2030).map((c) => c.year)).not.toContain(2032);
  });
  it('is empty when the pinned file is from the future', () => {
    expect(candidateFiles({ congress: 119, file: 'cb_2040_us_cd119_500k' }, 2026).map((c) => c.congress)).toEqual([]);
  });
  it('rejects a pinned name that is not an enacted-districts file', () => {
    expect(() => candidateFiles({ congress: 119, file: 'cb_2025_us_state_20m' }, 2026)).toThrow();
  });
});

describe('isServed', () => {
  it('is true for a 200 HEAD and false for a 404, without retrying', async () => {
    const f = server(['a']);
    expect(await isServed(URL_OF('a'), { fetchFn: f, sleep: noSleep })).toBe(true);
    expect(await isServed(URL_OF('b'), { fetchFn: f, sleep: noSleep })).toBe(false);
    expect(f).toHaveBeenCalledTimes(2);
    expect(f.mock.calls.every(([, init]) => init?.method === 'HEAD')).toBe(true);
  });
  it('falls back to a one-byte ranged GET when HEAD is not allowed', async () => {
    const f = server(['a'], { noHead: true });
    expect(await isServed(URL_OF('a'), { fetchFn: f, sleep: noSleep })).toBe(true);
    expect(await isServed(URL_OF('b'), { fetchFn: f, sleep: noSleep })).toBe(false);
    const gets = f.mock.calls.filter(([, init]) => init?.method === 'GET');
    expect(gets).toHaveLength(2);
    expect((gets[0]?.[1]?.headers as Record<string, string>).Range).toBe('bytes=0-0');
  });
  it('reads an HTML page with a 200 as absent', async () => {
    const f = vi.fn<typeof fetch>(async () => new Response(null, { status: 200, headers: { 'content-type': 'text/html' } }));
    expect(await isServed(URL_OF('a'), { fetchFn: f, sleep: noSleep })).toBe(false);
  });
  it('retries a 503 and a network error with doubling waits, then succeeds', async () => {
    const sleeps: number[] = [];
    const f = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(new Response(null, { status: 200, headers: { 'content-type': 'application/zip' } }));
    expect(await isServed(URL_OF('a'), { fetchFn: f, sleep: async (ms) => void sleeps.push(ms) })).toBe(true);
    expect(sleeps).toEqual([2000, 4000]);
  });
  it('fails on a persistent server error rather than reporting "absent"', async () => {
    const f = vi.fn<typeof fetch>(async () => new Response(null, { status: 500 }));
    const err = await isServed(URL_OF('a'), { fetchFn: f, sleep: noSleep }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DownloadError);
    expect(f).toHaveBeenCalledTimes(4);
  });
  it('fails on an unexpected status such as 403 without retrying', async () => {
    const f = vi.fn<typeof fetch>(async () => new Response(null, { status: 403 }));
    const err = await isServed(URL_OF('a'), { fetchFn: f, sleep: noSleep }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DownloadError);
    expect((err as DownloadError).status).toBe(403);
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe('detectUpdate', () => {
  it('reports no update when nothing newer is served', async () => {
    expect(await detectUpdate(pinned, 2026, URL_OF, { fetchFn: server(['cb_2025_us_cd119_500k']), sleep: noSleep })).toEqual({ update: false });
  });
  it('finds a newer release of the same Congress', async () => {
    const r = await detectUpdate(pinned, 2026, URL_OF, { fetchFn: server(['cb_2026_us_cd119_500k']), sleep: noSleep });
    expect(r).toEqual({ update: true, file: 'cb_2026_us_cd119_500k', congress: 119, year: 2026, url: URL_OF('cb_2026_us_cd119_500k') });
  });
  it('prefers the next Congress over a newer release of the same one', async () => {
    const r = await detectUpdate(pinned, 2027, URL_OF, { fetchFn: server(['cb_2027_us_cd119_500k', 'cb_2026_us_cd120_500k']), sleep: noSleep });
    expect(r).toMatchObject({ update: true, file: 'cb_2026_us_cd120_500k', congress: 120 });
  });
  it('prefers the newest year within a Congress', async () => {
    const r = await detectUpdate(pinned, 2027, URL_OF, { fetchFn: server(['cb_2026_us_cd119_500k', 'cb_2027_us_cd119_500k']), sleep: noSleep });
    expect(r).toMatchObject({ update: true, file: 'cb_2027_us_cd119_500k' });
  });
  it('propagates a persistent probe failure', async () => {
    const f = vi.fn<typeof fetch>(async () => new Response(null, { status: 502 }));
    await expect(detectUpdate(pinned, 2026, URL_OF, { fetchFn: f, sleep: noSleep })).rejects.toBeInstanceOf(DownloadError);
  });
});
