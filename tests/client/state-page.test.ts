// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MapUnavailableError } from '../../src/client/shared';
import { getLocated, setLocated } from '../../src/client/shared';
import type { Navigate, StateRoute } from '../../src/client/shared';

const map = vi.hoisted(() => ({ impl: (): Promise<unknown> => Promise.reject(new Error('unset')), calls: 0 }));
vi.mock('../../src/client/widgets/district-map', () => ({
  createDistrictMap: () => {
    map.calls++;
    return map.impl();
  },
}));

const fault = vi.hoisted(() => ({ failOnce: false }));
vi.mock('../../src/client/pages/state/lookup', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/client/pages/state/lookup')>();
  return {
    ...real,
    lookupDistricts: (...args: Parameters<typeof real.lookupDistricts>) => {
      if (fault.failOnce) {
        fault.failOnce = false;
        throw new Error('build failed partway');
      }
      return real.lookupDistricts(...args);
    },
  };
});

const geo = vi.hoisted(() => ({ impl: (): Promise<unknown> => Promise.reject(new Error('unset')) }));
vi.mock('../../src/client/features/address-search/geocode', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  geocodeAddress: () => geo.impl(),
}));

const flush = async (): Promise<void> => {
  for (let i = 0; i < 30; i++) await new Promise((r) => setTimeout(r, 0));
};

beforeEach(() => {
  map.calls = 0;
  map.impl = () => Promise.reject(new MapUnavailableError('webgl'));
  // Serve the published data files straight from public/data.
  vi.stubGlobal('fetch', (url: string) => {
    const path = new URL(String(url)).pathname.replace(/^.*\/data\//, '');
    try {
      return Promise.resolve(new Response(readFileSync(`public/data/${path}`)));
    } catch {
      return Promise.resolve(new Response('no', { status: 404 }));
    }
  });
});
afterEach(() => {
  setLocated(null);
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

function route(patch: Partial<StateRoute>): StateRoute {
  return { page: 'state', abbr: 'AK', district: null, cut: null, move: null, plan: 'finished', enacted: false, ...patch };
}

async function mount(initial: StateRoute) {
  const navs: unknown[] = [];
  const nav: Navigate = (r, o) => void navs.push([r, o]);
  const { createStatePage } = await import('../../src/client/pages/state');
  const page = createStatePage(initial, nav);
  document.body.append(page.el);
  await flush();
  return { page, navs };
}

describe('a link to a cut or balancing move a single-seat state does not have', () => {
  it.each([
    ['cut 1', { cut: 1 }, /single district, so there are no cuts/],
    ['cut 0', { cut: 0 }, /single district, so there are no cuts/],
    ['balance 0', { move: 0 }, /needed no balancing moves/],
    ['balance 1', { move: 1 }, /needed no balancing moves/],
  ])('%s opens the plain state page and fixes the address bar', async (_name, patch, text) => {
    const { page, navs } = await mount(route(patch));
    expect(page.el.dataset.cutMode).toBe('false');
    expect(page.el.dataset.phase).toBe('none');
    expect(page.el.querySelector('.strv-notice')!.textContent).toMatch(text);
    const [corrected, opts] = navs.at(-1) as [StateRoute, { replace: boolean }];
    expect(corrected.cut).toBeNull();
    expect(corrected.move).toBeNull();
    expect(opts.replace).toBe(true);
    page.destroy();
  });
});

const lookup = { lonLat: [-149.9, 61.2] as [number, number], matchedAddress: '1 MAIN ST, ANCHORAGE, AK, 99501', matchCount: 1, block: null };

async function lateAnswer(page: { el: HTMLElement; destroy(): void }, answer: unknown): Promise<void> {
  let resolve!: (v: unknown) => void;
  geo.impl = () => new Promise((r) => (resolve = r));
  const form = page.el.querySelector<HTMLElement>('form')!;
  form.querySelector('input')!.value = '1 Main St, Anchorage';
  form.dispatchEvent(new Event('submit', { cancelable: true }));
  await flush();
  page.destroy();
  resolve(answer);
  await flush();
}

describe('an address answer that arrives after the visitor left the page', () => {
  it('does not navigate or remember the address (state page, other state)', async () => {
    const { page, navs } = await mount(route({}));
    const before = navs.length;
    await lateAnswer(page, { ...lookup, state: 'CO' });
    expect(navs).toHaveLength(before);
    expect(getLocated()).toBeNull();
  });

  it('does not select a district (state page, this state)', async () => {
    const { page, navs } = await mount(route({}));
    const before = navs.length;
    await lateAnswer(page, { ...lookup, state: 'AK' });
    expect(navs).toHaveLength(before);
    expect(getLocated()).toBeNull();
  });

  it('does not navigate (national page)', async () => {
    const navs: unknown[] = [];
    const { createNationalPage } = await import('../../src/client/pages/national');
    const page = createNationalPage((r: unknown) => void navs.push(r));
    document.body.append(page.el);
    await flush();
    await lateAnswer(page, { ...lookup, state: 'CO' });
    expect(navs).toHaveLength(0);
    expect(getLocated()).toBeNull();
  });
});

describe('Try again after the page build throws partway', () => {
  it('removes everything the failed build added, then builds once', async () => {
    setLocated({ state: 'AK', lonLat: [-150, 64], matchedAddress: '1 Test St' });
    fault.failOnce = true;
    const { page } = await mount(route({}));
    const panel = page.el.querySelector('.strv-state__panel')!;
    // build() had already appended its sections to the panel when it threw; they are gone again.
    const trimmed = panel.children.length;
    expect(page.el.querySelector('.strv-error button')).not.toBeNull();
    expect(page.el.querySelectorAll('.strv-scrub')).toHaveLength(0);
    expect(page.el.querySelectorAll('[id="strv-address-state"]')).toHaveLength(0);
    page.el.querySelector<HTMLButtonElement>('.strv-error button')!.click();
    await flush();
    expect(page.el.querySelectorAll('.strv-scrub')).toHaveLength(1);
    expect(page.el.querySelectorAll('[id="strv-address-state"]')).toHaveLength(1);
    expect(panel.children.length).toBeGreaterThan(trimmed);
    page.destroy();
  });
});

describe('Try again after the map fails to mount', () => {
  it('rebuilds only the map, not the panel', async () => {
    map.impl = () => Promise.reject(new Error('boom'));
    const { page } = await mount(route({}));
    expect(page.el.querySelector('.strv-error button')).not.toBeNull();
    expect(page.el.querySelectorAll('.strv-scrub')).toHaveLength(1);
    const panelKids = page.el.querySelector('.strv-state__panel')!.children.length;
    map.impl = () => Promise.reject(new MapUnavailableError('webgl'));
    page.el.querySelector<HTMLButtonElement>('.strv-error button')!.click();
    await flush();
    expect(map.calls).toBe(2);
    expect(page.el.querySelectorAll('[id="strv-address-state"]')).toHaveLength(1);
    expect(page.el.querySelectorAll('.strv-scrub')).toHaveLength(1);
    expect(page.el.querySelector('.strv-state__panel')!.children).toHaveLength(panelKids);
    page.destroy();
  });
});

