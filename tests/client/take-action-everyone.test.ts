// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetAsks } from '../../src/client/entities/counts';
import { createEveryone, TOO_LONG_COPY } from '../../src/client/widgets/take-action/everyone';
import { fittingMailtoHref, groupMailtoHref, MAILTO_LIMIT, uniqueEmails } from '../../src/client/widgets/take-action/mailto';
import type { Rep } from '../../src/client/entities/reps';

const rep = (id: string, over: Partial<Rep> = {}): Rep => ({ id, name: `Name ${id}`, office: 'state-senate', districtCode: null, contactUrl: null, email: null, phone: null, address: null, website: null, social: {}, ...over });
const entry = (key: string, office: 'us-house' | 'us-senate' | 'state-house' | 'state-senate', r: Rep) => ({ key, office, label: key, rep: r });
const base = {
  stateName: 'Colorado',
  mapUrl: 'https://example.org/CO',
  places: [{ office: 'state-senate' as const, code: '031' }, { office: 'us-house' as const, code: '01' }],
};
const reps = [
  entry('CO:state-senate:031', 'state-senate', rep('A', { email: 'a@coleg.gov' })),
  entry('CO:state-house:006', 'state-house', rep('B', { email: 'b@coleg.gov', phone: '555-0101' })),
  entry('CO:us-house:01', 'us-house', rep('C', { website: 'https://c.house.gov', phone: '+1 202 225 4431' })),
  entry('CO:us-senate:state', 'us-senate', rep('D', { contactUrl: 'https://d.senate.gov/contact' })),
  entry('CO:us-senate:state', 'us-senate', rep('E')),
];

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  resetAsks();
  fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const asks = (): string[] => fetchMock.mock.calls.filter((c) => c[0] === '/api/ask').map((c) => (JSON.parse((c[1] as RequestInit).body as string) as { key: string }).key);

describe('Email all of them at once', () => {
  it('has the heading and one mailto to every rep who lists an email, with the combined letter', () => {
    const el = createEveryone({ ...base, reps });
    expect(el.querySelector('h3')!.textContent).toBe('Email all of them at once');
    const a = [...el.querySelectorAll('a')].find((x) => x.textContent === 'Email everyone')!;
    const href = a.getAttribute('href')!;
    expect(href.startsWith('mailto:a@coleg.gov,b@coleg.gov?subject=')).toBe(true);
    const subject = decodeURIComponent(href.match(/subject=([^&]*)/)![1]!);
    const body = decodeURIComponent(href.match(/body=(.*)$/)![1]!);
    expect(subject).toBe('Please support the Fair Maps rule for Colorado');
    expect(body).toBe(el.querySelector('.strv-ask__letter')!.textContent);
    expect(body.startsWith('Dear Representatives,\n\nI live in Colorado State Senate district 31 and Colorado’s 1st congressional district.')).toBe(true);
    expect(href + body).not.toContain('—');
  });

  it('lists every rep without an email with their form, website or phone, marks one done when used, and counts the ask once per office', () => {
    const el = createEveryone({ ...base, reps });
    const items = [...el.querySelectorAll('.strv-act__todo-item')];
    expect(items).toHaveLength(3);
    const links = (i: number) => [...items[i]!.querySelectorAll('a')].map((a) => [a.textContent, a.getAttribute('href'), a.getAttribute('target'), a.getAttribute('rel')]);
    expect(links(0)).toEqual([['Their website', 'https://c.house.gov', '_blank', 'noopener'], ['Call +1 202 225 4431', 'tel:+12022254431', null, null]]);
    expect(links(1)).toEqual([['Open their contact form', 'https://d.senate.gov/contact', '_blank', 'noopener']]);
    expect(items[2]!.textContent).toContain('No contact details published.');
    expect(el.textContent).toContain('Most House offices only accept messages through the contact form on their site.');
    expect(items[1]!.getAttribute('data-done')).toBeNull();
    const form = items[1]!.querySelector('a')!;
    form.addEventListener('click', (e) => e.preventDefault());
    form.click();
    expect(items[1]!.getAttribute('data-done')).toBe('true');
    expect((items[1]!.querySelector('.strv-act__done') as HTMLElement).hidden).toBe(false);
    expect(items[0]!.getAttribute('data-done')).toBeNull();
    form.click();
    expect(asks()).toEqual(['CO:us-senate:state']);
  });

  it('counts the offices that were emailed when Email everyone is used, and every office for Copy letter', () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(async () => undefined) }, configurable: true });
    const el = createEveryone({ ...base, reps });
    const mail = [...el.querySelectorAll('a')].find((x) => x.textContent === 'Email everyone')!;
    mail.addEventListener('click', (e) => e.preventDefault());
    mail.click();
    expect(asks()).toEqual(['CO:state-senate:031', 'CO:state-house:006']);
    ([...el.querySelectorAll('button')].find((b) => b.textContent === 'Copy letter') as HTMLButtonElement).click();
    expect(asks()).toEqual(['CO:state-senate:031', 'CO:state-house:006', 'CO:us-house:01', 'CO:us-senate:state']);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('Dear Representatives,'));
  });

  it('falls back to Copy emails and Copy letter when the link would be too long', () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const many = Array.from({ length: 60 }, (_, i) => entry(`CO:state-house:${i}`, 'state-house', rep(`m${i}`, { email: `representative.number${i}@legislature.example.gov` })));
    const el = createEveryone({ ...base, reps: many });
    expect([...el.querySelectorAll('a')].find((x) => x.textContent === 'Email everyone')).toBeUndefined();
    expect(el.textContent).toContain(TOO_LONG_COPY);
    const copyEmails = [...el.querySelectorAll('button')].find((b) => b.textContent === 'Copy emails') as HTMLButtonElement;
    copyEmails.click();
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('representative.number0@legislature.example.gov, representative.number1@'));
    expect([...el.querySelectorAll('button')].some((b) => b.textContent === 'Copy letter')).toBe(true);
  });

  it('offers only the letter and the checklist when nobody lists an email', () => {
    const el = createEveryone({ ...base, reps: reps.slice(2) });
    expect(el.querySelector('a[href^="mailto:"]')).toBeNull();
    expect(el.textContent).toContain('None of your representatives list an email address');
    expect([...el.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Copy letter']);
  });
});

describe('group mailto', () => {
  const letter = { subject: 'S & T', body: 'Line one\nLine two' };
  it('joins the To list with commas and keeps @ readable', () => {
    expect(groupMailtoHref(['a@b.co', 'c@d.gov'], letter)).toBe('mailto:a@b.co,c@d.gov?subject=S%20%26%20T&body=Line%20one%0ALine%20two');
  });
  it('removes repeats ignoring case', () => {
    expect(uniqueEmails(['A@b.co', 'a@B.co', ' ', 'c@d.gov'])).toEqual(['A@b.co', 'c@d.gov']);
  });
  it('gives no link past the limit or without recipients', () => {
    expect(fittingMailtoHref([], letter)).toBeNull();
    expect(fittingMailtoHref(['a@b.co'], letter)).not.toBeNull();
    expect(fittingMailtoHref(['a@b.co'], { subject: 's', body: 'x'.repeat(MAILTO_LIMIT) })).toBeNull();
  });
});
