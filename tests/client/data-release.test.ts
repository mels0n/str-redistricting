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

describe('release skew', () => {
  it('is none when the stamp matches, is missing, or the session has no release', async () => {
    const { checkRelease, setDataRelease, setSkewHandler } = await import('../../src/client/shared');
    const handler = vi.fn();
    setSkewHandler(handler);
    expect(checkRelease({ maps: 7 })).toBe(false);
    setDataRelease(7);
    expect(checkRelease({ maps: 7 })).toBe(false);
    expect(checkRelease(undefined)).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });

  it('moves to the new release, drops cached files and tells the handler', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(url);
        return new Response(JSON.stringify({ n: 1 }));
      }),
    );
    const { z } = await import('zod');
    const { fetchJson, checkRelease, setDataRelease, getDataRelease, setSkewHandler, dataUrl } = await import('../../src/client/shared');
    const handler = vi.fn();
    setSkewHandler(handler);
    setDataRelease(7);
    const schema = z.object({ n: z.number() });
    await fetchJson(dataUrl('CO/cuts.json'), schema);
    await fetchJson(dataUrl('CO/cuts.json'), schema);
    expect(calls).toHaveLength(1);
    expect(checkRelease({ maps: 8 })).toBe(true);
    expect(getDataRelease()).toBe(8);
    expect(handler).toHaveBeenCalledWith(8);
    await fetchJson(dataUrl('CO/cuts.json'), schema);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain('v=8');
  });

  it('is found when a state stats file names another release than the session', async () => {
    const real = JSON.parse(readFileSync('public/data/CO/stats.json', 'utf8')) as Record<string, unknown>;
    const stats = { ...real, versions: { engine: '1.2.3', input: { vintage: 'census-2020', revision: 3, sha256: 'c'.repeat(64) }, maps: 8, schema: '1.0.0' } };
    respond(200, stats);
    const { setDataRelease, setSkewHandler } = await import('../../src/client/shared');
    const { loadStats } = await import('../../src/client/entities/plan');
    const handler = vi.fn();
    setSkewHandler(handler);
    setDataRelease(7);
    await loadStats('CO');
    expect(handler).toHaveBeenCalledWith(8);
  });
});
