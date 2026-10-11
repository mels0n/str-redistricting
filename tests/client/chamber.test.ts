// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chamberDataPath, districtLabel, enactedDistrictsName, reproduceCommands } from '../../src/client/shared';
import type { Navigate, StateRoute } from '../../src/client/shared';
import { StateIndexSchema, isGeneratedIn, liveChambers, seatsIn } from '../../src/client/entities/state';

const summary = {
  population: 100,
  ideal: 50,
  rangePersons: 1,
  rangePct: 0.01,
  allContiguous: true,
  assignmentSha256: 'a'.repeat(64),
  inputSha256: 'b'.repeat(64),
  lineSearch: 'exact',
};

const oldIndex = { states: [{ abbr: 'NE', name: 'Nebraska', seats: 3, hasData: true, summary }] };
const newIndex = {
  states: [
    {
      abbr: 'NE',
      name: 'Nebraska',
      seats: 3,
      hasData: true,
      summary,
      chambers: { 'state-house': { seats: 0, hasData: false }, 'state-senate': { seats: 49, hasData: false } },
    },
    {
      abbr: 'VT',
      name: 'Vermont',
      seats: 1,
      hasData: true,
      summary,
      chambers: { 'state-house': { seats: 150, hasData: true, summary }, 'state-senate': { seats: 30, hasData: false } },
    },
  ],
};

describe('chambers in the index', () => {
  it('parses an index that has no chambers, and treats the state chambers as absent', () => {
    const index = StateIndexSchema.parse(oldIndex);
    expect(seatsIn(index.states[0]!, 'federal-house')).toBe(3);
    expect(seatsIn(index.states[0]!, 'state-senate')).toBe(0);
    expect(isGeneratedIn(index.states[0]!, 'state-senate')).toBe(false);
    expect([...liveChambers(index)]).toEqual(['federal-house']);
  });

  it('reads seats and drawn state per chamber', () => {
    const index = StateIndexSchema.parse(newIndex);
    const [ne, vt] = index.states as [(typeof index.states)[number], (typeof index.states)[number]];
    expect(seatsIn(ne, 'state-house')).toBe(0);
    expect(isGeneratedIn(vt, 'state-house')).toBe(true);
    expect(isGeneratedIn(vt, 'state-senate')).toBe(false);
    expect(new Set(liveChambers(index))).toEqual(new Set(['federal-house', 'state-house']));
  });
});

describe('chamber wording and paths', () => {
  it('keeps the federal data path and nests the others', () => {
    expect(chamberDataPath('CO', 'federal-house')).toBe('CO');
    expect(chamberDataPath('CO', 'state-senate')).toBe('CO/state-senate');
  });

  it('labels districts and the enacted overlay by chamber', () => {
    expect(districtLabel('federal-house', 3)).toBe('Congressional district 3');
    expect(districtLabel('state-senate', 12)).toBe('State Senate district 12');
    expect(districtLabel('state-house', 40)).toBe('State House district 40');
    expect(enactedDistrictsName('federal-house', 'cb_2025_us_cd119_500k')).toBe('119th Congress districts');
    expect(enactedDistrictsName('state-senate', 'cb_2025_08_sldu_500k')).toBe('Current State Senate districts');
  });

  it('adds --chamber to the reproduce commands only for a state chamber', () => {
    expect(reproduceCommands('CO', 4)).not.toContain('--chamber');
    expect(reproduceCommands('CO', 4, 'state-senate')).toContain('npm run explore -- --states CO --chamber state-senate');
  });
});

const flush = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
};

describe('the state page for a chamber', () => {
  const requested: string[] = [];
  beforeEach(() => {
    requested.length = 0;
    vi.stubGlobal('fetch', (url: string) => {
      const path = new URL(String(url)).pathname.replace(/^.*\/data\//, '');
      requested.push(path);
      if (path === 'index.json') return Promise.resolve(new Response(JSON.stringify(newIndex)));
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

  async function mount(patch: Partial<StateRoute>) {
    const nav: Navigate = () => undefined;
    const { createStatePage } = await import('../../src/client/pages/state');
    const route: StateRoute = { page: 'state', abbr: 'NE', chamber: 'federal-house', district: null, cut: null, move: null, plan: 'finished', enacted: false, ...patch };
    const page = createStatePage(route, nav);
    document.body.append(page.el);
    await flush();
    return page;
  }

  it('says a state with one legislative chamber has no State House, and draws no map', async () => {
    const page = await mount({ chamber: 'state-house' });
    expect(page.el.textContent).toContain('Nebraska has one legislative chamber, its Senate. There is no State House to draw.');
    expect(page.el.querySelector('a[href="#/NE/senate"]')).not.toBeNull();
    expect(page.el.textContent).not.toContain(String.fromCharCode(0x2014));
    expect(requested.filter((p) => p.startsWith('NE/'))).toEqual([]);
    page.destroy();
  });

  it('says a chamber that is not drawn yet is not drawn yet, and loads none of its files', async () => {
    const page = await mount({ chamber: 'state-senate' });
    expect(page.el.textContent).toContain('State Senate maps for Nebraska are not drawn yet.');
    expect(page.el.querySelector('a[href="#/NE"]')).not.toBeNull();
    expect(requested.filter((p) => p.startsWith('NE/'))).toEqual([]);
    page.destroy();
  });
});
