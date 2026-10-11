// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const schema = z.object({ ok: z.boolean() });
const json = (): Response => new Response(JSON.stringify({ ok: true }), { status: 200 });

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

describe('fetchJson cache', () => {
  it('keeps a newer entry when an older request for the same URL fails after the cache was cleared', async () => {
    let rejectOld: (e: Error) => void = () => undefined;
    const f = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(() => new Promise<Response>((_res, rej) => void (rejectOld = rej)))
      .mockImplementation(async () => json());
    vi.stubGlobal('fetch', f);
    const { fetchJson, clearFetchCache } = await import('../../src/client/shared/api/fetch-json');
    const old = fetchJson('/a.json', schema).catch(() => 'failed');
    clearFetchCache();
    await fetchJson('/a.json', schema);
    rejectOld(new Error('late'));
    expect(await old).toBe('failed');
    await fetchJson('/a.json', schema);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('remembers only the 32 most recent URLs, evicting the oldest first', async () => {
    const f = vi.fn<typeof fetch>(async () => json());
    vi.stubGlobal('fetch', f);
    const { fetchJson } = await import('../../src/client/shared/api/fetch-json');
    for (let i = 1; i <= 33; i++) await fetchJson(`/f${i}.json`, schema);
    expect(f).toHaveBeenCalledTimes(33);
    await fetchJson('/f33.json', schema);
    expect(f).toHaveBeenCalledTimes(33);
    await fetchJson('/f1.json', schema);
    expect(f).toHaveBeenCalledTimes(34);
  });
});
