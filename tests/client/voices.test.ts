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
    if (chamber !== 'federal-house') throw new Error('missing');
    return { lines: null, features: [square('03')] };
  },
}));
vi.mock('../../src/client/entities/reps', async (orig) => ({
  ...(await orig<typeof import('../../src/client/entities/reps')>()),
  loadStateReps: async () => ({
    state: 'CO',
    generatedFrom: {},
    byKey: { 'CO:us-house:03': [{ id: 'H', name: 'Name H', office: 'us-house', districtCode: null, contactUrl: 'https://x.gov/c', email: 'a@b.co', phone: null, address: null, website: null, social: {} }] },
  }),
}));
vi.mock('../../src/client/entities/pledges', async (orig) => ({
  ...(await orig<typeof import('../../src/client/entities/pledges')>()),
  loadPledges: async () => [],
}));

import { loadNotes } from '../../src/client/entities/notes';
import { createRepPanel } from '../../src/client/widgets/take-action/panel';
import { createVoices } from '../../src/client/widgets/voices';

const note = (body: string, over: Record<string, unknown> = {}) => ({ body, name: 'Maria G.', town: 'Boulder', at: '2026-10-27T12:00:00Z', ...over });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('loadNotes', () => {
  it('asks its own origin for a district or for the country', async () => {
    fetchMock.mockResolvedValue(Response.json({ notes: [note('Fair maps')] }));
    expect(await loadNotes({ key: 'CO:us-house:03' })).toEqual([note('Fair maps')]);
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/notes?key=CO%3Aus-house%3A03');
    await loadNotes({ national: true });
    expect(fetchMock.mock.calls[1]![0]).toBe('/api/notes?national=1');
  });

  it('returns null on a 503, a bad body and a network error', async () => {
    fetchMock.mockResolvedValue(Response.json({ error: 'unavailable' }, { status: 503 }));
    expect(await loadNotes({ national: true })).toBeNull();
    fetchMock.mockResolvedValue(Response.json({ notes: 'x' }));
    expect(await loadNotes({ national: true })).toBeNull();
    fetchMock.mockRejectedValue(new TypeError('offline'));
    expect(await loadNotes({ national: true })).toBeNull();
  });
});

describe('voices widget', () => {
  it('shows the heading and each note with its byline as plain text', async () => {
    fetchMock.mockResolvedValue(Response.json({ notes: [note('Fair <b>maps</b>'), note('Same rule for all', { name: null, town: null })] }));
    const v = createVoices({ scope: { key: 'CO:us-house:03' }, heading: 'Voices from this district' });
    expect(v.el.hidden).toBe(true);
    await v.ready;
    expect(v.el.hidden).toBe(false);
    expect(v.el.querySelector('h3')!.textContent).toBe('Voices from this district');
    const quotes = [...v.el.querySelectorAll('blockquote')].map((e) => e.textContent);
    expect(quotes).toEqual(['Fair <b>maps</b>', 'Same rule for all']);
    expect(v.el.querySelector('b')).toBeNull();
    const by = [...v.el.querySelectorAll('.strv-voices__by')].map((e) => e.textContent);
    expect(by).toEqual(['Maria G., Boulder, October 27, 2026', 'October 27, 2026']);
  });

  it('shows at most the limit', async () => {
    fetchMock.mockResolvedValue(Response.json({ notes: [1, 2, 3, 4, 5].map((n) => note(`n${n}`)) }));
    const v = createVoices({ scope: { national: true }, heading: 'Why people signed', limit: 3 });
    await v.ready;
    expect(v.el.querySelectorAll('blockquote')).toHaveLength(3);
  });

  it('renders nothing when the fetch fails, answers badly or has no notes', async () => {
    for (const setup of [
      () => fetchMock.mockRejectedValue(new TypeError('offline')),
      () => fetchMock.mockResolvedValue(Response.json({ error: 'unavailable' }, { status: 503 })),
      () => fetchMock.mockResolvedValue(Response.json({ nope: 1 })),
      () => fetchMock.mockResolvedValue(Response.json({ notes: [] })),
    ]) {
      setup();
      const v = createVoices({ scope: { national: true }, heading: 'Why people signed' });
      await v.ready;
      expect(v.el.hidden).toBe(true);
      expect(v.el.textContent).toBe('');
    }
  });

  it('shows nothing after it was destroyed', async () => {
    fetchMock.mockResolvedValue(Response.json({ notes: [note('x')] }));
    const v = createVoices({ scope: { national: true }, heading: 'h' });
    v.destroy();
    await v.ready;
    expect(v.el.hidden).toBe(true);
  });
});

describe('rep panel voices', () => {
  const input = { state: 'CO', stateName: 'Colorado', located: { state: 'CO', lonLat: [0.5, 0.5] as [number, number], matchedAddress: '1 Main St' } };

  it('puts the district’s notes in the panel, once, and removes them when the address goes', async () => {
    fetchMock.mockResolvedValue(Response.json({ notes: [note('Fair maps')] }));
    const keys: string[] = [];
    const p = createRepPanel((key) => {
      keys.push(key);
      return createVoices({ scope: { key }, heading: 'Voices from this district' });
    });
    await p.update(input);
    await new Promise((r) => setTimeout(r, 0));
    expect(keys).toEqual(['CO:us-house:03']);
    expect(p.el.querySelector('.strv-reps__voices h3')!.textContent).toBe('Voices from this district');
    await p.update(input);
    expect(p.el.querySelectorAll('.strv-voices')).toHaveLength(1);
    await p.update({ ...input, located: null });
    expect(p.el.querySelector('.strv-voices')).toBeNull();
  });
});
