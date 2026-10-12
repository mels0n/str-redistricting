// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { CHAMBERS, config, formatHash, stateRoute, nationalRoute, NATIONAL } from '../../src/client/shared';
import type { Chamber } from '../../src/client/shared';
import { createSiteHeader, syncChamberSwitch } from '../../src/client/widgets/site-header';

describe('site header', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('names the site and links home', () => {
    const title = createSiteHeader().querySelector('.strv-masthead__title')!;
    expect(title.textContent).toBe('Fair Maps');
    expect(title.getAttribute('href')).toBe(formatHash(NATIONAL));
  });

  it('has one way home: the title, not a second All states link', () => {
    const header = createSiteHeader();
    const homeLinks = [...header.querySelectorAll('a')].filter((a) => a.getAttribute('href') === formatHash(NATIONAL) && !a.hasAttribute('data-chamber'));
    expect(homeLinks).toHaveLength(1);
    expect(header.textContent).not.toContain('All states');
    expect([...header.querySelectorAll('.strv-masthead__nav a')].map((a) => a.textContent || a.getAttribute('aria-label'))).toEqual(['FAQ', 'How it works', 'Source code on GitHub']);
  });

  it('links the source code on GitHub, after the page links, with no byline', () => {
    const header = createSiteHeader();
    const repo = header.querySelector('.strv-masthead__repo')!;
    expect(repo.getAttribute('href')).toBe(config.repoUrl);
    expect(repo.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(header.lastElementChild?.lastElementChild).toBe(repo);
    expect(header.textContent).not.toContain('Chris Melson');
    expect(header.querySelector('.strv-masthead__credit')).toBeNull();
  });

  it('lists every chamber in order; before the index is in only the federal House is a link, and it is the current one', () => {
    const items = [...createSiteHeader().querySelectorAll('.strv-chamber__item')];
    expect(items.map((i) => i.getAttribute('data-chamber'))).toEqual(CHAMBERS.map((c) => c.key));
    for (const [i, c] of CHAMBERS.entries()) {
      const el = items[i]!;
      if (c.key === 'federal-house') {
        expect(el.tagName).toBe('A');
        expect(el.getAttribute('aria-current')).toBe('true');
      } else {
        // Not a link and not focusable: a coming-soon label.
        expect(el.tagName).toBe('SPAN');
        expect(el.hasAttribute('href')).toBe(false);
        expect(el.hasAttribute('tabindex')).toBe(false);
        expect(el.textContent).toBe(`${c.label} Soon`);
      }
    }
  });

  it('points the live chamber at the state on screen, and at the national map elsewhere', () => {
    document.body.append(createSiteHeader());
    const live = document.querySelector('[data-chamber="federal-house"]')!;
    syncChamberSwitch(stateRoute('CO', { district: 3 }));
    expect(live.getAttribute('href')).toBe(formatHash(stateRoute('CO')));
    syncChamberSwitch({ page: 'how', section: null });
    expect(live.getAttribute('href')).toBe(formatHash(NATIONAL));
  });

  it('turns a chamber into a link to the same state once the index says it has maps', () => {
    document.body.append(createSiteHeader());
    const live = new Set<Chamber>(['federal-house', 'state-senate']);
    syncChamberSwitch(stateRoute('CO', { district: 3 }), live);
    const house = document.querySelector('[data-chamber="state-house"]')!;
    const senate = document.querySelector('[data-chamber="state-senate"]')!;
    expect(house.tagName).toBe('SPAN');
    expect(house.textContent).toBe('State House Soon');
    expect(senate.tagName).toBe('A');
    expect(senate.getAttribute('href')).toBe('#/CO/senate');
    expect(document.querySelector('[data-chamber="federal-house"]')!.getAttribute('href')).toBe('#/CO');
    // Off a state page the links open that chamber's national map, and the current chamber is marked.
    syncChamberSwitch(nationalRoute('state-senate'), live);
    expect(document.querySelector('[data-chamber="state-senate"]')!.getAttribute('href')).toBe('#/senate');
    expect(document.querySelector('[data-chamber="state-senate"]')!.getAttribute('aria-current')).toBe('true');
    expect(document.querySelector('[data-chamber="federal-house"]')!.hasAttribute('aria-current')).toBe(false);
  });

  it('marks the chamber on screen as current before the index says what is live', () => {
    document.body.append(createSiteHeader());
    syncChamberSwitch(stateRoute('CO', { chamber: 'state-senate' }));
    const senate = document.querySelector('[data-chamber="state-senate"]')!;
    expect(senate.getAttribute('aria-current')).toBe('true');
    expect(document.querySelector('[data-chamber="federal-house"]')!.hasAttribute('aria-current')).toBe(false);
    expect(document.querySelector('[data-chamber="state-house"]')!.hasAttribute('aria-current')).toBe(false);
  });
});
