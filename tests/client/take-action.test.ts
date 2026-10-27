// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Feature, Polygon } from 'geojson';

const square: Feature<Polygon, { label: string; code: string }> = {
  type: 'Feature',
  properties: { label: '03', code: '03' },
  geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] },
};
vi.mock('../../src/client/entities/plan', () => ({
  loadEnacted: async (_s: string, chamber: string) => {
    if (chamber !== 'federal-house') throw new Error('missing');
    return { lines: null, features: [square] };
  },
}));
vi.mock('../../src/client/entities/reps', async (orig) => ({
  ...(await orig<typeof import('../../src/client/entities/reps')>()),
  loadStateReps: async () => ({
    state: 'CO',
    generatedFrom: {},
    byKey: { 'CO:us-house:03': [{ id: 'H', name: 'Name H', office: 'us-house', districtCode: '03', contactUrl: null, email: 'h@x.gov', phone: null, address: null, website: null, social: {} }] },
  }),
}));
vi.mock('../../src/client/entities/pledges', async (orig) => ({
  ...(await orig<typeof import('../../src/client/entities/pledges')>()),
  loadPledges: async () => [],
}));
vi.mock('../../src/client/features/sign-on/turnstile', () => ({
  mountTurnstile: async () => ({ reset: () => undefined, remove: () => undefined }),
}));
vi.mock('../../src/client/features/address-search/geocode', async (orig) => ({
  ...(await orig<typeof import('../../src/client/features/address-search/geocode')>()),
  geocodeAddress: async () => ({ matchedAddress: '1 MAIN ST, DENVER, CO, 80203', lonLat: [0.5, 0.5], state: 'CO', block: null, matchCount: 1 }),
}));

import { setLocated } from '../../src/client/shared';
import { createTakeAction } from '../../src/client/widgets/take-action';

const settle = async (): Promise<void> => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
};
const q = <T extends Element>(root: Element, sel: string): T => root.querySelector<T>(sel)!;

beforeEach(() => {
  setLocated(null);
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('take-action widget', () => {
  it('starts with the address step and the add-your-name step, and shows no representatives yet', () => {
    const w = createTakeAction({ id: 'a', heading: { level: 2, text: 'Take action' } });
    expect(q(w.el, 'h2').textContent).toBe('Take action');
    expect([...w.el.querySelectorAll('.strv-act__step-h')].map((e) => e.textContent)).toEqual(['Find your representatives', 'Add your name']);
    expect(q<HTMLElement>(w.el, '.strv-reps').hidden).toBe(true);
    expect(w.el.querySelector('.strv-sign')).toBeNull();
    expect(q(w.el, 'label[for="a-address"]').textContent).toBe('Your street address');
  });

  it('has no widget heading or intro when the page supplies its own', () => {
    const w = createTakeAction({ id: 'a', heading: null });
    expect(w.el.querySelector('h2')).toBeNull();
    expect(w.el.getAttribute('aria-label')).toBe('Take action');
    expect(w.el.querySelector('.strv-act__lede')).toBeNull();
  });

  it('opens the sign form without any address, on the state from the link, and closes it again', async () => {
    const w = createTakeAction({ id: 'a', state: 'CO' });
    document.body.append(w.el);
    const open = q<HTMLButtonElement>(w.el, '.strv-act__step--sign button');
    open.click();
    await settle();
    expect(open.getAttribute('aria-expanded')).toBe('true');
    expect(q<HTMLSelectElement>(w.el, '.strv-sign [name="state"]').value).toBe('CO');
    expect(q<HTMLInputElement>(w.el, '.strv-sign [name="address"]').value).toBe('');
    open.click();
    expect(w.el.querySelector('.strv-sign')).toBeNull();
  });

  it('ignores a state that is not one of the 50', () => {
    const w = createTakeAction({ id: 'a', state: 'ZZ' });
    q<HTMLButtonElement>(w.el, '.strv-act__step--sign button').click();
    expect(q<HTMLSelectElement>(w.el, '.strv-sign [name="state"]').value).toBe('');
  });

  it('finds the representatives for an address, offers Email everyone, and prefills the sign form with it', async () => {
    const w = createTakeAction({ id: 'a' });
    document.body.append(w.el);
    q<HTMLInputElement>(w.el, '#a-address').value = '1 Main St';
    q<HTMLFormElement>(w.el, 'form.strv-search').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await settle();
    expect(q<HTMLElement>(w.el, '.strv-reps').hidden).toBe(false);
    expect(q(w.el, '.strv-reps__office').textContent).toBe('U.S. House, CO-03');
    expect(q(w.el, '.strv-act__all h3').textContent).toBe('Email all of them at once');
    expect(q(w.el, '.strv-search__status').textContent).toBe('Found 1 MAIN ST, DENVER, CO, 80203. Your representatives are below.');
    q<HTMLButtonElement>(w.el, '.strv-act__step--sign button').click();
    await settle();
    expect(q<HTMLInputElement>(w.el, '.strv-sign [name="address"]').value).toBe('1 MAIN ST, DENVER, CO, 80203');
    expect(q<HTMLSelectElement>(w.el, '.strv-sign [name="state"]').value).toBe('CO');
  });

  it('shows the reps of an address looked up earlier on the visit', async () => {
    setLocated({ state: 'CO', lonLat: [0.5, 0.5], matchedAddress: '1 Main St' });
    const w = createTakeAction({ id: 'a' });
    await settle();
    expect(q<HTMLElement>(w.el, '.strv-reps').hidden).toBe(false);
  });
});

describe('take-action widget after it is destroyed', () => {
  it('ignores a late address answer', async () => {
    const w = createTakeAction({ id: 'a' });
    document.body.append(w.el);
    q<HTMLInputElement>(w.el, '#a-address').value = '1 Main St';
    q<HTMLFormElement>(w.el, 'form.strv-search').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    w.destroy();
    await settle();
    const { getLocated } = await import('../../src/client/shared');
    expect(getLocated()).toBeNull();
  });
});
