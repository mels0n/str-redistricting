// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Feature, Polygon } from 'geojson';

const square = (code: string): Feature<Polygon, { label: string; code: string }> => ({
  type: 'Feature',
  properties: { label: code, code },
  geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] },
});

vi.mock('../../src/client/entities/plan', () => ({
  loadEnacted: async (_state: string, chamber: string) => {
    const code = { 'federal-house': '03', 'state-house': '004', 'state-senate': '012' }[chamber];
    if (!code) throw new Error('missing');
    return { lines: null, features: [square(code)] };
  },
}));

const rep = (id: string, office: string) => ({ id, name: `Name ${id}`, office, districtCode: null, contactUrl: 'https://x.gov/c', email: 'a@b.co', phone: null, address: null, website: null, social: {} });
const file = {
  state: 'CO',
  generatedFrom: {},
  byKey: {
    'CO:state-senate:012': [rep('SS', 'state-senate')],
    'CO:state-house:004': [rep('SH', 'state-house')],
    'CO:us-house:03': [rep('H', 'us-house')],
    'CO:us-senate:state': [rep('S1', 'us-senate'), rep('S2', 'us-senate')],
  } as Record<string, unknown>,
};

vi.mock('../../src/client/entities/reps', async (orig) => ({
  ...(await orig<typeof import('../../src/client/entities/reps')>()),
  loadStateReps: async () => file,
}));
vi.mock('../../src/client/entities/badge-sites', async (orig) => ({
  ...(await orig<typeof import('../../src/client/entities/badge-sites')>()),
  loadBadgeSites: async () => [],
}));

import { loadCounts, shownCounts, recordAsk, resetAsks } from '../../src/client/entities/counts';
import { captureSigned, takeSigned } from '../../src/client/shared';
import { createRepPanel } from '../../src/client/widgets/take-action/panel';

const input = { state: 'CO', stateName: 'Colorado', located: { state: 'CO', lonLat: [0.5, 0.5] as [number, number], matchedAddress: '1 Main St' } };

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  resetAsks();
  fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('loadCounts', () => {
  it('reads the counts for a state from its own origin', async () => {
    fetchMock.mockResolvedValue(Response.json({ national: 9, state: 4, waiting: 1, byKey: { 'CO:us-house:03': 2 } }));
    expect(await loadCounts('CO')).toEqual({ national: 9, state: 4, waiting: 1, byKey: { 'CO:us-house:03': 2 } });
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/counts?state=CO');
  });

  it('fills the missing fields when only the national total comes back', async () => {
    fetchMock.mockResolvedValue(Response.json({ national: 9 }));
    expect(await loadCounts()).toEqual({ national: 9, state: 0, waiting: 0, byKey: {} });
  });

  it('returns null on a 503, a bad body and a network error', async () => {
    fetchMock.mockResolvedValue(Response.json({ error: 'unavailable' }, { status: 503 }));
    expect(await loadCounts('CO')).toBeNull();
    fetchMock.mockResolvedValue(Response.json({ national: 'x' }));
    expect(await loadCounts('CO')).toBeNull();
    fetchMock.mockRejectedValue(new TypeError('offline'));
    expect(await loadCounts('CO')).toBeNull();
  });

  it('gives up after 4 seconds', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(
      (_u: string, init: RequestInit) => new Promise((_res, rej) => init.signal!.addEventListener('abort', () => rej(init.signal!.reason))),
    );
    const p = loadCounts('CO');
    await vi.advanceTimersByTimeAsync(4001);
    expect(await p).toBeNull();
  });
});

describe('recordAsk', () => {
  it('fires once per office per page load and ignores errors', () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    recordAsk('CO:us-house:03', 'us-house');
    recordAsk('CO:us-house:03', 'us-house');
    recordAsk('CO:state-house:004', 'state-house');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/ask');
    expect(init).toMatchObject({ method: 'POST', keepalive: true });
    expect(JSON.parse(init.body)).toEqual({ key: 'CO:us-house:03', office: 'us-house' });
  });
});

describe('shownCounts', () => {
  const c = (national: number) => ({ national, state: 0, waiting: 0, byKey: {} });
  it('hides every count below 1000, shows them from exactly 1000, and shows nothing for a failed load', () => {
    expect(shownCounts(c(999))).toBeNull();
    expect(shownCounts(c(1000))).toEqual(c(1000));
    expect(shownCounts(c(5000))).toEqual(c(5000));
    expect(shownCounts(null)).toBeNull();
  });
});

describe('rep panel asks', () => {
  it('records an ask once per office when the letter is used', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => undefined }, configurable: true });
    const p = createRepPanel();
    await p.update(input);
    const row = p.el.querySelectorAll('li')[0]!;
    (row.querySelector('button') as HTMLButtonElement).click();
    const copy = [...row.querySelectorAll('button')].find((b) => b.textContent === 'Copy letter')!;
    copy.click();
    copy.click();
    const email = [...row.querySelectorAll('a')].find((a) => a.textContent === 'Email')!;
    email.addEventListener('click', (e) => e.preventDefault());
    email.click();
    const asks = fetchMock.mock.calls.filter((c) => c[0] === '/api/ask');
    expect(asks).toHaveLength(1);
    expect(JSON.parse(asks[0]![1].body)).toEqual({ key: 'CO:state-senate:012', office: 'state-senate' });
  });
});

describe('signed notice', () => {
  it('is read once from the query string', () => {
    captureSigned('?signed=1');
    expect(takeSigned()).toBe('ok');
    expect(takeSigned()).toBeNull();
    captureSigned('?signed=expired');
    expect(takeSigned()).toBe('expired');
    captureSigned('?signed=other');
    expect(takeSigned()).toBeNull();
  });
});
