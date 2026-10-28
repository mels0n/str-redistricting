// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PAGE_META } from '../../src/client/shared';
import type { BadgeSite } from '../../src/client/entities/badge-sites';

let fixture: BadgeSite[] | null = [];
vi.mock('../../src/client/entities/badge-sites', async (orig) => ({
  ...(await orig<typeof import('../../src/client/entities/badge-sites')>()),
  loadBadgeSites: async () => fixture,
}));

import { createPledgesPage } from '../../src/client/pages/pledges';

const site = (host: string, over: Partial<BadgeSite> = {}): BadgeSite => ({ url: `https://${host}/`, host, title: `Title of ${host}`, name: null, office: null, id: null, ...over });
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('sites that show the badge page', () => {
  afterEach(() => document.body.replaceChildren());

  it('has the heading, lede, how-to section and the exact snippet', async () => {
    const page = createPledgesPage();
    await flush();
    expect(page.el.querySelector('h1')!.textContent).toBe('Sites that show the Fair Maps badge');
    expect(page.el.querySelector('.strv-how__lede')!.textContent).toBe('These websites show our badge. Each entry links to the page where it appears. Showing the badge is the only thing we check. Party is not shown.');
    expect([...page.el.querySelectorAll('h2')].map((e) => e.textContent)).toEqual(['Show the badge on your site']);
    expect(page.el.querySelector('pre')!.textContent).toBe('<a href="https://fairmaps.melson.us/pledges"><img src="https://fairmaps.melson.us/api/badge" alt="I back Fair Maps" width="200" height="40"></a>');
    const text = page.el.textContent!;
    expect(text).toContain('Put it on your home page. We check each site about once a day; if the badge is gone for two daily checks, the site comes off the list.');
    expect(text).toContain('Older snippets that point at /badge.svg are not noticed. Use the snippet above.');
    expect(text).toContain('Add the badge to your home page and link it to fairmaps.melson.us/pledges. It usually shows up within minutes, otherwise within a day.');
    expect(text).toContain('What we look for: the badge image (fairmaps.melson.us/api/badge) and a link to fairmaps.melson.us on the same page.');
    expect(document.title).toBe(PAGE_META.pledges.title);
    expect(PAGE_META.pledges.title).toBe('Sites that show the Fair Maps badge | Fair Maps');
    expect(text).not.toContain('—');
    expect(PAGE_META.pledges.description).not.toContain('—');
  });

  it('shows a neutral static line, not a claim, before the list arrives', () => {
    const page = createPledgesPage();
    expect(page.el.querySelector('.strv-pledges__empty')!.textContent).toBe('The list of sites is shown here.');
    expect(page.el.textContent).not.toContain('Loading');
  });

  it('says so when no site shows the badge', async () => {
    fixture = [];
    const page = createPledgesPage();
    await flush();
    expect(page.el.querySelector('.strv-pledges__empty')!.textContent).toBe('No sites show the badge yet.');
  });

  it('says so when the list will not load', async () => {
    fixture = null;
    const page = createPledgesPage();
    await flush();
    expect(page.el.querySelector('.strv-pledges__empty')!.textContent).toBe('We couldn’t load the list. Try again later.');
  });

  it('lists each site with its name or title, its host and a link to the exact page, in the order given', async () => {
    fixture = [site('a.example.org', { url: 'https://a.example.org/about', name: 'Jane Hurd', office: 'U.S. House, CO', id: 'H1' }), site('b.example.org')];
    const page = createPledgesPage();
    await flush();
    const rows = [...page.el.querySelectorAll('.strv-pledges__row')];
    expect(rows.map((r) => r.querySelector('strong')!.textContent)).toEqual(['Jane Hurd', 'b.example.org']);
    expect(rows.map((r) => r.querySelector('small')!.textContent)).toEqual(['Title of a.example.org', 'Title of b.example.org']);
    expect(rows[0]!.textContent).toContain('U.S. House, CO');
    expect(rows[0]!.textContent).toContain('a.example.org');
    const link = rows[0]!.querySelector('a')!;
    expect(link.textContent).toBe('View the page');
    expect(link.getAttribute('href')).toBe('https://a.example.org/about');
    expect(link.getAttribute('rel')).toBe('noopener');
  });

  it('shows page text as text, never as markup, and no party', async () => {
    fixture = [site('c.example.org', { title: '<b onclick=alert(1)>hi</b>' })];
    const page = createPledgesPage();
    await flush();
    expect(page.el.querySelector('.strv-pledges__row b')).toBeNull();
    expect(page.el.querySelector('.strv-pledges__row small')!.textContent).toBe('<b onclick=alert(1)>hi</b>');
    expect(page.el.textContent!.toLowerCase()).not.toMatch(/republican|democrat/);
  });

  it('takes a list handed in directly', () => {
    const page = createPledgesPage([site('z.example.org')]);
    expect(page.el.querySelectorAll('.strv-pledges__row')).toHaveLength(1);
  });
});
