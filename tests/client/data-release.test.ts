// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const published = { engine: '1.2.3', input: { vintage: 'census-2020', revision: 3, sha256: 'c'.repeat(64) }, maps: 7, schema: '1.0.0', web: '9.9.9', docs: '1.0.0' };

const respond = (status: number, body: unknown) => vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })));

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

describe('data URLs carry the maps release', () => {
  it('stay plain while no release is known', async () => {
    const { dataUrl } = await import('../../src/client/shared');
    expect(dataUrl('CO/stats.json')).not.toContain('?');
  });

  it('add ?v= once a release is set, to JSON and pmtiles alike, but never to versions.json', async () => {
    const { dataUrl, setDataRelease } = await import('../../src/client/shared');
    const { blocksUrl } = await import('../../src/client/widgets/district-map/blocks');
    const { detailSource } = await import('../../src/client/widgets/district-map/detail');
    setDataRelease(7);
    expect(new URL(dataUrl('CO/stats.json')).searchParams.get('v')).toBe('7');
    expect(dataUrl('versions.json')).not.toContain('?');
    expect(blocksUrl('CO')).toMatch(/^pmtiles:\/\/.*CO\/blocks\.pmtiles\?v=7$/);
    expect(detailSource('CO').tiles![0]).toMatch(/CO\/detail\.pmtiles\?v=7\/\{z\}\/\{x\}\/\{y\}$/);
  });

  it('are set at boot from the published versions file', async () => {
    respond(200, published);
    const { initDataRelease, getDataRelease } = await import('../../src/client/shared');
    await initDataRelease();
    expect(getDataRelease()).toBe(7);
  });

  it('stay plain when nothing is stamped yet (no versions file)', async () => {
    respond(404, {});
    const { initDataRelease, getDataRelease, dataUrl } = await import('../../src/client/shared');
    await initDataRelease();
    expect(getDataRelease()).toBeNull();
    expect(dataUrl('CO/stats.json')).not.toContain('?v=');
  });
});

describe('boot', () => {
  it('starts with plain URLs when versions.json does not answer within the boot timeout', async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_res, rej) => {
        init?.signal?.addEventListener('abort', () => rej(new Error('aborted')));
      })));
      const { initDataRelease, getDataRelease, dataUrl, BOOT_TIMEOUT_MS } = await import('../../src/client/shared');
      const booted = initDataRelease();
      await vi.advanceTimersByTimeAsync(BOOT_TIMEOUT_MS + 1);
      await booted;
      expect(BOOT_TIMEOUT_MS).toBeLessThan(10_000);
      expect(getDataRelease()).toBeNull();
      expect(dataUrl('CO/stats.json')).not.toContain('?v=');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('release skew', () => {
  /** Serves versions.json at `maps` and counts how often it is asked for (and with which cache mode). */
  const serve = (maps: number) => {
    const init: (RequestInit | undefined)[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, i?: RequestInit) => {
      if (url.includes('versions.json')) {
        init.push(i);
        return new Response(JSON.stringify({ ...published, maps }));
      }
      return new Response(JSON.stringify({ n: 1 }));
    }));
    return init;
  };

  it('is none when the stamp matches, is missing, older, or the session has no release', async () => {
    const init = serve(7);
    const { checkRelease, setDataRelease, setSkewHandler } = await import('../../src/client/shared');
    const handler = vi.fn();
    setSkewHandler(handler);
    expect(await checkRelease({ maps: 7 })).toBe(false);
    setDataRelease(7);
    expect(await checkRelease({ maps: 7 })).toBe(false);
    expect(await checkRelease({ maps: 6 })).toBe(false);
    expect(await checkRelease(undefined)).toBe(false);
    expect(handler).not.toHaveBeenCalled();
    expect(init).toHaveLength(0);
  });

  it('confirms against versions.json (uncached), drops cached files and tells the handler when it names a newer release', async () => {
    const init = serve(8);
    const { z } = await import('zod');
    const { fetchJson, checkRelease, setDataRelease, getDataRelease, setSkewHandler, dataUrl } = await import('../../src/client/shared');
    const handler = vi.fn();
    setSkewHandler(handler);
    setDataRelease(7);
    const schema = z.object({ n: z.number() });
    await fetchJson(dataUrl('CO/cuts.json'), schema);
    await fetchJson(dataUrl('CO/cuts.json'), schema);
    const fetchMock = vi.mocked(fetch);
    const filesFetched = (): number => fetchMock.mock.calls.filter(([u]) => !String(u).includes('versions.json')).length;
    expect(filesFetched()).toBe(1);
    expect(await checkRelease({ maps: 8 })).toBe(true);
    expect(init[0]?.cache).toBe('no-store');
    expect(getDataRelease()).toBe(7);
    expect(handler).toHaveBeenCalledWith(8);
    await fetchJson(dataUrl('CO/cuts.json'), schema);
    expect(filesFetched()).toBe(2);
  });

  it('is not skew when a state is stamped newer but versions.json is unchanged (a mixed publish)', async () => {
    const init = serve(7);
    const { checkRelease, setDataRelease, getDataRelease, setSkewHandler } = await import('../../src/client/shared');
    const handler = vi.fn();
    setSkewHandler(handler);
    setDataRelease(7);
    expect(await checkRelease({ maps: 8 })).toBe(false);
    expect(await checkRelease({ maps: 8 })).toBe(false);
    expect(handler).not.toHaveBeenCalled();
    expect(getDataRelease()).toBe(7);
    expect(init).toHaveLength(1);
  });

  it('survives two states stamped V and W in either load order: the session stays put and nothing reloads', async () => {
    for (const order of [[8, 7], [7, 8]]) {
      vi.resetModules();
      serve(7);
      const { checkRelease, setDataRelease, getDataRelease, setSkewHandler } = await import('../../src/client/shared');
      const handler = vi.fn();
      setSkewHandler(handler);
      setDataRelease(7);
      await Promise.all(order.map((maps) => checkRelease({ maps })));
      for (const maps of [...order, ...order]) await checkRelease({ maps });
      expect(handler).not.toHaveBeenCalled();
      expect(getDataRelease()).toBe(7);
    }
  });

  it('with versions.json at the newer release, asks for at most one reload however many states report it', async () => {
    serve(8);
    const { checkRelease, setDataRelease, setSkewHandler } = await import('../../src/client/shared');
    const handler = vi.fn();
    setSkewHandler(handler);
    setDataRelease(7);
    await Promise.all([checkRelease({ maps: 8 }), checkRelease({ maps: 7 }), checkRelease({ maps: 8 })]);
    await checkRelease({ maps: 8 });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('is found when a state stats file names a newer release than the session and versions.json agrees', async () => {
    const real = JSON.parse(readFileSync('public/data/CO/stats.json', 'utf8')) as Record<string, unknown>;
    const stats = { ...real, versions: { engine: '1.2.3', input: { vintage: 'census-2020', revision: 3, sha256: 'c'.repeat(64) }, maps: 8, schema: '1.0.0' } };
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(url.includes('versions.json') ? { ...published, maps: 8 } : stats))));
    const { setDataRelease, setSkewHandler } = await import('../../src/client/shared');
    const { loadStats } = await import('../../src/client/entities/plan');
    const handler = vi.fn();
    setSkewHandler(handler);
    setDataRelease(7);
    await loadStats('CO');
    await vi.waitFor(() => expect(handler).toHaveBeenCalledWith(8));
  });
});
