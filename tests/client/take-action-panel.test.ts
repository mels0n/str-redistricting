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
    'CO:us-house:03': [rep('H', 'us-house', { email: 'h@x.gov', contactUrl: 'https://x.gov/contact', phone: '+1 (202) 225-4431 x5' })],
    'CO:us-senate:state': [rep('S1', 'us-senate', { contactUrl: 'https://s.gov/c' })],
  } as Record<string, unknown>,
};

vi.mock('../../src/client/entities/reps', async (orig) => ({
  ...(await orig<typeof import('../../src/client/entities/reps')>()),
  loadStateReps: async () => file,
}));

let badgeSites: unknown[] | null = [];
vi.mock('../../src/client/entities/badge-sites', async (orig) => ({
  ...(await orig<typeof import('../../src/client/entities/badge-sites')>()),
  loadBadgeSites: async () => badgeSites,
}));

import { config } from '../../src/client/shared';
import { createRepPanel } from '../../src/client/widgets/take-action/panel';

const located = { state: 'CO', lonLat: [0.5, 0.5] as [number, number], matchedAddress: '1 Main St' };
const input = { state: 'CO', stateName: 'Colorado', located };
const buttons = (root: Element) => [...root.querySelectorAll('button, a')].map((b) => b.textContent);

describe('rep panel', () => {
  it('says what to do while no address is located, and has no Share button', async () => {
    const p = createRepPanel();
    expect(p.el.textContent).toBe('Enter your address above to see who represents you.');
    await p.update({ ...input, located: null });
    expect(p.el.textContent).toBe('Enter your address above to see who represents you.');
    expect(p.el.querySelector('li')).toBeNull();
  });

  it('says so when the representatives cannot be loaded', async () => {
    const saved = file.byKey;
    (file as { byKey: unknown }).byKey = null;
    const p = createRepPanel();
    await p.update(input);
    expect(p.el.querySelector('[role="alert"]')!.textContent).toBe('We couldn’t load your representatives. Try again in a moment.');
    (file as { byKey: unknown }).byKey = saved;
  });

  it('lists state senate, state house, US House, US Senate in order with labels, one line each', async () => {
    const p = createRepPanel();
    await p.update(input);
    const offices = [...p.el.querySelectorAll('.strv-reps__office')].map((e) => e.textContent);
    expect(offices).toEqual(['State Senate, district 12', 'State House, district 4', 'U.S. House, CO-03', 'U.S. Senate']);
    expect(p.el.querySelector('h3')).toBeNull();
    expect(buttons(p.el).filter((t) => t === 'Share')).toEqual([]);
  });

  it('gives each row the actions it has: Write to them, Email, Contact form, Website, Call, in that order', async () => {
    file.byKey['CO:us-house:03'] = [rep('H', 'us-house', { email: 'h@x.gov', contactUrl: 'https://x.gov/contact', website: 'https://h.gov', phone: '+1 (202) 225-4431 x5' })];
    const p = createRepPanel();
    await p.update(input);
    const rows = [...p.el.querySelectorAll('li')];
    expect(buttons(rows[0]!.querySelector('.strv-reps__actions')!)).toEqual(['Write to them', 'Email']);
    expect(buttons(rows[1]!.querySelector('.strv-reps__actions')!)).toEqual(['Write to them', 'Call']);
    expect(buttons(rows[2]!.querySelector('.strv-reps__actions')!)).toEqual(['Write to them', 'Email', 'Contact form', 'Call']);
    const contact = [...rows[2]!.querySelectorAll('a')].find((a) => a.textContent === 'Contact form')!;
    expect(contact.getAttribute('target')).toBe('_blank');
    expect(contact.getAttribute('rel')).toBe('noopener');
    expect(rows[2]!.getAttribute('data-done')).toBeNull();
    contact.addEventListener('click', (e) => e.preventDefault());
    contact.click();
    expect(rows[2]!.getAttribute('data-done')).toBe('true');
    expect(rows[0]!.getAttribute('data-done')).toBeNull();
    file.byKey['CO:us-house:03'] = [rep('H', 'us-house', { email: 'h@x.gov', contactUrl: 'https://x.gov/contact', phone: '+1 (202) 225-4431 x5' })];
  });

  it('offers a website button only when there is no contact form, and the combined email above the list', async () => {
    file.byKey['CO:us-house:03'] = [rep('H', 'us-house', { website: 'https://h.gov', phone: '555-0100' })];
    const p = createRepPanel();
    await p.update(input);
    const row = [...p.el.querySelectorAll('li')][2]!;
    expect(buttons(row.querySelector('.strv-reps__actions')!)).toEqual(['Write to them', 'Website', 'Call']);
    expect(p.el.firstElementChild!.classList.contains('strv-act__all')).toBe(true);
    file.byKey['CO:us-house:03'] = [rep('H', 'us-house', { email: 'h@x.gov', contactUrl: 'https://x.gov/contact', phone: '+1 (202) 225-4431 x5' })];
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
    expect(body).toContain('I live in Colorado State Senate district 12.');
  });

  it('shows copy, print, the phone and the plain no-online message when a rep has no form or email', async () => {
    const p = createRepPanel();
    await p.update(input);
    const row = p.el.querySelectorAll('li')[1]!;
    (row.querySelector('button') as HTMLButtonElement).click();
    const composer = row.querySelector('.strv-ask')!;
    expect(buttons(composer)).toEqual(['555-0100', 'Copy letter', 'Print']);
    expect(composer.textContent).toContain('Phone: 555-0100');
    expect(composer.textContent).toContain('We don’t have a way to send this to them online. You can call or look up their office.');
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

  it('keeps one composer open at a time', async () => {
    const p = createRepPanel();
    await p.update(input);
    const rows = [...p.el.querySelectorAll('li')];
    (rows[0]!.querySelector('button') as HTMLButtonElement).click();
    (rows[1]!.querySelector('button') as HTMLButtonElement).click();
    expect(p.el.querySelectorAll('.strv-ask')).toHaveLength(1);
    expect(rows[0]!.querySelector('.strv-ask')).toBeNull();
    expect(rows[1]!.querySelector('.strv-ask')).not.toBeNull();
  });

  it('marks only the printed letter and clears the mark afterwards', async () => {
    vi.stubGlobal('print', vi.fn());
    const p = createRepPanel();
    await p.update(input);
    const row = p.el.querySelectorAll('li')[1]!;
    (row.querySelector('button') as HTMLButtonElement).click();
    const printBtn = [...row.querySelectorAll('button')].find((b) => b.textContent === 'Print')!;
    printBtn.click();
    expect(row.querySelector('.strv-ask')!.hasAttribute('data-printing')).toBe(true);
    expect(document.documentElement.hasAttribute('data-print-letter')).toBe(true);
    window.dispatchEvent(new Event('afterprint'));
    expect(row.querySelector('.strv-ask')!.hasAttribute('data-printing')).toBe(false);
    expect(document.documentElement.hasAttribute('data-print-letter')).toBe(false);
    vi.unstubAllGlobals();
  });

  it('shows the contact form link only for http and https addresses', async () => {
    file.byKey['CO:us-senate:state'] = [rep('S1', 'us-senate', { contactUrl: 'javascript:alert(1)' })];
    const p = createRepPanel();
    await p.update(input);
    const row = [...p.el.querySelectorAll('li')][3]!;
    (row.querySelector('button') as HTMLButtonElement).click();
    expect(buttons(row)).not.toContain('Open their contact form');
    file.byKey['CO:us-senate:state'] = [rep('S1', 'us-senate', { contactUrl: 'https://s.gov/c' })];
    const q = createRepPanel();
    await q.update(input);
    const row2 = [...q.el.querySelectorAll('li')][3]!;
    (row2.querySelector('button') as HTMLButtonElement).click();
    const link = [...row2.querySelectorAll('a')].find((a) => a.textContent === 'Open their contact form')!;
    expect(link.getAttribute('href')).toBe('https://s.gov/c');
    expect(link.getAttribute('rel')).toBe('noopener');
  });

  it('builds tel: links from digits and a leading plus only', async () => {
    const p = createRepPanel();
    await p.update(input);
    const call = [...p.el.querySelectorAll('a')].filter((a) => a.textContent === 'Call').map((a) => a.getAttribute('href'));
    expect(call).toEqual(['tel:5550100', 'tel:+120222544315', 'tel:5550100']);
  });

  describe('the badge', () => {
    const site = (host: string, url = `https://${host}/`) => ({ url, host, title: null, name: null, office: null });

    it('marks the rep whose website host is in the list (www ignored), with a link to the exact page', async () => {
      badgeSites = [site('hurd.example.gov', 'https://hurd.example.gov/about')];
      (file.byKey['CO:us-house:03'] as unknown[])[0] = rep('H', 'us-house', { email: 'h@x.gov', contactUrl: 'https://x.gov/contact', phone: '+1 (202) 225-4431 x5', website: 'https://www.hurd.example.gov/' });
      const p = createRepPanel();
      await p.update(input);
      const rows = [...p.el.querySelectorAll('li')];
      expect(rows[2]!.textContent).toContain('Shows the Fair Maps badge');
      const link = rows[2]!.querySelector('a.strv-reps__badge-page')!;
      expect(link.textContent).toBe('View the page');
      expect(link.getAttribute('href')).toBe('https://hurd.example.gov/about');
      expect(rows[0]!.textContent).not.toContain('Shows the Fair Maps badge');
      expect(p.el.textContent).not.toContain('Pledged');
    });

    it('marks no one when the list is empty, will not load, or the host differs', async () => {
      for (const list of [[], null, [site('other.example.org')]]) {
        badgeSites = list;
        const p = createRepPanel();
        await p.update(input);
        expect(p.el.textContent).not.toContain('Shows the Fair Maps badge');
        expect(p.el.querySelectorAll('li').length).toBeGreaterThan(0);
      }
      badgeSites = [];
    });
  });
});
