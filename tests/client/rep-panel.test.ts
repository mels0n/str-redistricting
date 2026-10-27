// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
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

const rep = (id: string, office: string, over: Record<string, unknown> = {}) => ({
  id, name: `Name ${id}`, office, districtCode: null, contactUrl: null, email: null, phone: '555-0100', address: null, website: null, social: {}, ...over,
});
const file = {
  state: 'CO',
  generatedFrom: {},
  byKey: {
    'CO:state-senate:012': [rep('SS', 'state-senate', { email: 'a@b.co', phone: null })],
    'CO:state-house:004': [rep('SH', 'state-house')],
    'CO:us-house:03': [rep('H', 'us-house', { email: 'h@x.gov', contactUrl: 'https://x.gov/contact' })],
    'CO:us-senate:state': [rep('S1', 'us-senate', { contactUrl: 'https://s.gov/c' })],
  } as Record<string, unknown>,
};

vi.mock('../../src/client/entities/reps', async (orig) => ({
  ...(await orig<typeof import('../../src/client/entities/reps')>()),
  loadStateReps: async () => file,
}));

import { createRepPanel } from '../../src/client/widgets/rep-panel';

const located = { state: 'CO', lonLat: [0.5, 0.5] as [number, number], matchedAddress: '1 Main St' };
const input = { state: 'CO', stateName: 'Colorado', located };
const buttons = (root: Element) => [...root.querySelectorAll('button, a')].map((b) => b.textContent);

describe('rep panel', () => {
  it('renders nothing while no address is located', async () => {
    const p = createRepPanel();
    await p.update({ ...input, located: null });
    expect(p.el.hidden).toBe(true);
    expect(p.el.childElementCount).toBe(0);
  });

  it('lists state senate, state house, US House, US Senate in order with labels', async () => {
    const p = createRepPanel();
    await p.update(input);
    expect(p.el.hidden).toBe(false);
    expect(p.el.querySelector('h3')!.textContent).toBe('Who represents you today');
    const offices = [...p.el.querySelectorAll('.strv-reps__office')].map((e) => e.textContent);
    expect(offices).toEqual(['State Senate, district 12', 'State House, district 4', 'U.S. House, CO-03', 'U.S. Senate']);
  });

  it('offers Call only when there is a phone number', async () => {
    const p = createRepPanel();
    await p.update(input);
    const rows = [...p.el.querySelectorAll('li')];
    expect(buttons(rows[0]!)).not.toContain('Call');
    expect(buttons(rows[1]!)).toContain('Call');
  });

  it('puts a mailto link that decodes to the exact letter in the composer', async () => {
    const p = createRepPanel();
    await p.update(input);
    const row = p.el.querySelectorAll('li')[0]!;
    (row.querySelector('button') as HTMLButtonElement).click();
    const a = [...row.querySelectorAll('a')].find((x) => x.textContent === 'Email')!;
    const url = new URL(a.getAttribute('href')!.replace('mailto:', 'http://m/'));
    const subject = decodeURIComponent(a.getAttribute('href')!.match(/subject=([^&]*)/)![1]!);
    const body = decodeURIComponent(a.getAttribute('href')!.match(/body=(.*)$/)![1]!);
    expect(url.host).toBe('m');
    expect(subject).toBe('Please support the Fair Maps rule for Colorado');
    expect(body).toBe(row.querySelector('.strv-ask__letter')!.textContent);
    expect(body).toContain('I live in State Senate, district 12.');
  });

  it('shows only copy and print and the phone when a rep has no form or email', async () => {
    const p = createRepPanel();
    await p.update(input);
    const row = p.el.querySelectorAll('li')[1]!;
    (row.querySelector('button') as HTMLButtonElement).click();
    const composer = row.querySelector('.strv-ask')!;
    expect(buttons(composer)).toEqual(['Copy letter', 'Print']);
    expect(composer.textContent).toContain('Phone: 555-0100');
  });

  it('says so for a seat with no published reps', async () => {
    delete file.byKey['CO:state-house:004'];
    const p = createRepPanel();
    await p.update(input);
    expect(p.el.textContent).toContain('We don’t have contact details for this seat yet.');
    file.byKey['CO:state-house:004'] = [rep('SH', 'state-house')];
  });

  it('says the address could not be placed and keeps the US Senate rows', async () => {
    const p = createRepPanel();
    await p.update({ ...input, located: { ...located, lonLat: [9, 9] } });
    expect(p.el.textContent).toContain('We couldn’t place this address in a district.');
    expect([...p.el.querySelectorAll('.strv-reps__office')].map((e) => e.textContent)).toEqual(['U.S. Senate']);
  });
});
