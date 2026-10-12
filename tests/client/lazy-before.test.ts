// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Navigate, StateRoute } from '../../src/client/shared';

vi.mock('../../src/client/widgets/district-map', async () => {
  const { MapUnavailableError } = await import('../../src/client/shared');
  return { createDistrictMap: () => Promise.reject(new MapUnavailableError('webgl')) };
});

const flush = async (): Promise<void> => {
  for (let i = 0; i < 30; i++) await new Promise((r) => setTimeout(r, 0));
};

let fetched: string[];
let failBefore: boolean;

beforeEach(() => {
  vi.resetModules();
  fetched = [];
  failBefore = false;
  // Serve the published data files straight from public/data, and note each one asked for.
  vi.stubGlobal('fetch', (url: string) => {
    const path = new URL(String(url)).pathname.replace(/^.*\/data\//, '');
    fetched.push(path);
    if (failBefore && path.endsWith('before.topo.json')) return Promise.resolve(new Response('no', { status: 404 }));
    try {
      return Promise.resolve(new Response(readFileSync(`public/data/${path}`)));
    } catch {
      return Promise.resolve(new Response('no', { status: 404 }));
    }
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

const beforeFetches = (): string[] => fetched.filter((p) => p.endsWith('before.topo.json'));

function route(patch: Partial<StateRoute>): StateRoute {
  return { page: 'state', abbr: 'CO', chamber: 'federal-house', district: null, cut: null, move: null, plan: 'finished', enacted: false, ...patch };
}

async function mount(initial: StateRoute) {
  const navs: [StateRoute, { replace?: boolean } | undefined][] = [];
  const nav: Navigate = (r, o) => void navs.push([r as StateRoute, o]);
  const { createStatePage } = await import('../../src/client/pages/state');
  const page = createStatePage(initial, nav);
  document.body.append(page.el);
  await flush();
  return { page, navs };
}

describe('the plan before balancing', () => {
  it('is not fetched for the finished map', async () => {
    const { page } = await mount(route({}));
    expect(fetched).toContain('CO/districts.topo.json');
    expect(beforeFetches()).toEqual([]);
    page.destroy();
  });

  it('is fetched once, when the before view is first shown', async () => {
    const { page } = await mount(route({}));
    page.update!(route({ plan: 'before' }));
    await flush();
    expect(beforeFetches()).toEqual(['CO/before.topo.json']);
    page.update!(route({ plan: 'finished' }));
    page.update!(route({ plan: 'before' }));
    await flush();
    expect(beforeFetches()).toHaveLength(1);
    page.destroy();
  });

  it('is fetched once, when the cut sequence opens', async () => {
    const { page } = await mount(route({}));
    page.update!(route({ cut: 1 }));
    await flush();
    expect(beforeFetches()).toHaveLength(1);
    expect(page.el.dataset.cutMode).toBe('true');
    page.destroy();
  });

  it('is fetched with the page for a link to the before view', async () => {
    const { page } = await mount(route({ plan: 'before' }));
    expect(beforeFetches()).toEqual(['CO/before.topo.json']);
    page.destroy();
  });

  it('is fetched with the page for a link to a cut', async () => {
    const { page } = await mount(route({ cut: 3 }));
    expect(beforeFetches()).toHaveLength(1);
    expect(page.el.dataset.cutMode).toBe('true');
    page.destroy();
  });

  it('is fetched per chamber: a State House page asks for its own file', async () => {
    const { page } = await mount(route({ chamber: 'state-house', plan: 'before' }));
    expect(beforeFetches()).toEqual(['CO/state-house/before.topo.json']);
    page.destroy();
  });

  it('falls back to the finished map, with a notice, when the file cannot be fetched', async () => {
    const { page, navs } = await mount(route({}));
    failBefore = true;
    page.update!(route({ plan: 'before' }));
    await flush();
    const [corrected, opts] = navs.at(-1)!;
    expect(corrected.plan).toBe('finished');
    expect(opts?.replace).toBe(true);
    expect(page.el.querySelector('.strv-notice')!.textContent).toMatch(/before balancing could not be loaded/);
    page.destroy();
  });
});
