// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jsonp, JsonpError } from '../../src/client/shared/api/jsonp';

const g = globalThis as unknown as Record<string, unknown>;
const scripts = (): HTMLScriptElement[] => [...document.head.querySelectorAll('script')];
const callbackNames = (): string[] => Object.keys(g).filter((k) => k.startsWith('__strvGeo'));
const callbackOf = (script: HTMLScriptElement): string => new URL(script.src).searchParams.get('callback')!;

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  for (const s of scripts()) s.remove();
  for (const k of callbackNames()) delete g[k];
});

describe('jsonp', () => {
  it('resolves with the answer, then removes the script and the callback', async () => {
    const p = jsonp('https://example.test/geocode', { address: '1 Main St' }, 5000);
    const [script] = scripts();
    const name = callbackOf(script!);
    expect(typeof g[name]).toBe('function');
    (g[name] as (d: unknown) => void)({ ok: true });
    await expect(p).resolves.toEqual({ ok: true });
    expect(scripts()).toHaveLength(0);
    expect(callbackNames()).toHaveLength(0);
  });

  it('rejects with network when the script fails to load, and cleans up', async () => {
    const p = jsonp('https://example.test/geocode', {}, 5000);
    const [script] = scripts();
    script!.onerror!(new Event('error'));
    await expect(p).rejects.toMatchObject({ kind: 'network' });
    expect(scripts()).toHaveLength(0);
    expect(callbackNames()).toHaveLength(0);
  });

  it('rejects with no-callback when the script loads but never calls back, and cleans up', async () => {
    const p = jsonp('https://example.test/geocode', {}, 5000);
    const [script] = scripts();
    script!.onload!(new Event('load'));
    const err = await p.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(JsonpError);
    expect(err).toMatchObject({ kind: 'no-callback' });
    expect(scripts()).toHaveLength(0);
    expect(callbackNames()).toHaveLength(0);
  });

  it('times out, leaves an absorbing stub, and the late answer is ignored and removes the stub', async () => {
    const p = jsonp('https://example.test/geocode', {}, 1000);
    const name = callbackOf(scripts()[0]!);
    const settled = p.catch((e: unknown) => e);
    vi.advanceTimersByTime(1000);
    await expect(settled).resolves.toMatchObject({ kind: 'timeout' });
    expect(scripts()).toHaveLength(0);
    // The stub is still there to absorb a late answer without throwing.
    expect(typeof g[name]).toBe('function');
    expect(() => (g[name] as (d: unknown) => void)({ late: true })).not.toThrow();
    expect(g[name]).toBeUndefined();
  });

  it('lets the caller set other parameters but never format or callback', async () => {
    const p = jsonp('https://example.test/geocode', { address: 'x', format: 'json', callback: 'evil' }, 5000);
    const [script] = scripts();
    const q = new URL(script!.src).searchParams;
    expect(q.get('address')).toBe('x');
    expect(q.get('format')).toBe('jsonp');
    expect(q.get('callback')).not.toBe('evil');
    expect(q.get('callback')).toMatch(/^__strvGeo/);
    expect(g.evil).toBeUndefined();
    (g[q.get('callback')!] as (d: unknown) => void)(null);
    await p;
  });

  it('uses a different callback name for each lookup', () => {
    void jsonp('https://example.test/geocode', {}, 5000).catch(() => undefined);
    void jsonp('https://example.test/geocode', {}, 5000).catch(() => undefined);
    const names = scripts().map(callbackOf);
    expect(new Set(names).size).toBe(2);
  });
});
