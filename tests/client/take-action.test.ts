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
const mounts: number[] = [];
vi.mock('../../src/client/features/sign-on/turnstile', () => ({
  mountTurnstile: async () => {
    mounts.push(1);
    return { reset: () => undefined, remove: () => undefined };
  },
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

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  setLocated(null);
  mounts.length = 0;
  fetchMock = vi.fn(async () => new Response(null, { status: 404 }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('take-action widget', () => {
  it('has three numbered steps: find, ask, add your name, with the sign form already on the page', () => {
    const w = createTakeAction({ id: 'a' });
    expect([...w.el.querySelectorAll('.strv-act__step-h')].map((e) => e.textContent)).toEqual(['Find your representatives', 'Ask them', 'Add your name']);
    expect(w.el.querySelector('h1')).toBeNull();
    expect(q(w.el, '.strv-act__step--find label').textContent).toBe('Your street address');
    expect(q(w.el, '.strv-search__note').textContent).toBe('Sent to the Census Bureau geocoder to find your districts. We never keep it.');
    expect(q(w.el, '.strv-reps__empty').textContent).toBe('Enter your address above to see who represents you.');
    expect(q(w.el, '.strv-act__step--sign .strv-sign')).not.toBeNull();
    expect(w.el.querySelector('.strv-act__step--sign button[aria-expanded]')).toBeNull();
    expect(w.el.querySelector('.strv-sign__h')).toBeNull();
  });

  it('loads the bot check only once the form is focused, not when the page is built', async () => {
    const w = createTakeAction({ id: 'a' });
    document.body.append(w.el);
    await settle();
    expect(mounts).toHaveLength(0);
    q<HTMLInputElement>(w.el, '.strv-sign [name="email"]').dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    await settle();
    expect(mounts).toHaveLength(1);
    q<HTMLInputElement>(w.el, '.strv-sign [name="email"]').dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(mounts).toHaveLength(1);
  });

  it('starts the sign form on the state from the link, with no address, and ignores a state that is not one of the 50', () => {
    expect(q<HTMLSelectElement>(createTakeAction({ id: 'a', state: 'CO' }).el, '.strv-sign [name="state"]').value).toBe('CO');
    const w = createTakeAction({ id: 'b', state: 'ZZ' });
    expect(q<HTMLSelectElement>(w.el, '.strv-sign [name="state"]').value).toBe('');
    expect(q<HTMLInputElement>(w.el, '.strv-sign [name="address"]').value).toBe('');
  });

  it('finds the representatives for an address, offers one combined email, and prefills the sign form', async () => {
    const w = createTakeAction({ id: 'a' });
    document.body.append(w.el);
    q<HTMLInputElement>(w.el, '#a-address').value = '1 Main St';
    q<HTMLFormElement>(w.el, 'form.strv-search').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await settle();
    expect(q(w.el, '.strv-reps__office').textContent).toBe('U.S. House, CO-03');
    expect(q(w.el, '.strv-act__all a.strv-button--signal').textContent).toBe('Email everyone at once');
    expect(q(w.el, '.strv-search__status').textContent).toBe('Found 1 MAIN ST, DENVER, CO, 80203.');
    expect(q<HTMLInputElement>(w.el, '.strv-sign [name="address"]').value).toBe('1 MAIN ST, DENVER, CO, 80203');
    expect(q<HTMLSelectElement>(w.el, '.strv-sign [name="state"]').value).toBe('CO');
  });

  it('shows one count line near the sign form: everyone, and the state once an address is found', async () => {
    fetchMock.mockImplementation(async (url: string) => (String(url).startsWith('/api/counts') ? Response.json({ national: 1234, state: String(url).includes('state=CO') ? 87 : 0, waiting: 0, byKey: {} }) : new Response(null, { status: 404 })));
    const w = createTakeAction({ id: 'a' });
    document.body.append(w.el);
    await settle();
    const line = q<HTMLElement>(w.el, '.strv-act__step--sign .strv-act__count');
    expect(line.hidden).toBe(false);
    expect(line.textContent).toBe('1,234 people have signed');
    q<HTMLInputElement>(w.el, '#a-address').value = '1 Main St';
    q<HTMLFormElement>(w.el, 'form.strv-search').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await settle();
    expect(line.textContent).toBe('1,234 people have signed, 87 in Colorado');
    expect(w.el.querySelectorAll('.strv-act__count')).toHaveLength(1);
  });

  it.each([[999, true], [1000, false], [0, true]])('hides the count line below the threshold: national %i hidden=%s', async (national, hidden) => {
    fetchMock.mockImplementation(async (url: string) => (String(url).startsWith('/api/counts') ? Response.json({ national, state: 87, waiting: 0, byKey: {} }) : new Response(null, { status: 404 })));
    const w = createTakeAction({ id: 'a' });
    document.body.append(w.el);
    await settle();
    q<HTMLInputElement>(w.el, '#a-address').value = '1 Main St';
    q<HTMLFormElement>(w.el, 'form.strv-search').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await settle();
    const line = q<HTMLElement>(w.el, '.strv-act__count');
    expect(line.hidden).toBe(hidden);
    expect(line.textContent).toBe(hidden ? '' : '1,000 people have signed, 87 in Colorado');
  });

  it('shows no count line when the counts fail to load', async () => {
    const w = createTakeAction({ id: 'a' });
    document.body.append(w.el);
    await settle();
    expect(q<HTMLElement>(w.el, '.strv-act__count').hidden).toBe(true);
  });

  it('shows the reps of an address looked up earlier on the visit', async () => {
    setLocated({ state: 'CO', lonLat: [0.5, 0.5], matchedAddress: '1 Main St' });
    const w = createTakeAction({ id: 'a' });
    await settle();
    expect(w.el.querySelector('.strv-reps__row')).not.toBeNull();
  });

  it('ignores a late address answer after it is destroyed', async () => {
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
