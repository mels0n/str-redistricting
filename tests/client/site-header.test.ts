// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { CHAMBERS, formatHash, stateRoute, NATIONAL } from '../../src/client/shared';
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

  it('lists every chamber in order; only the live one is a link, and it is the current one', () => {
    const items = [...createSiteHeader().querySelectorAll('.strv-chamber__item')];
    expect(items.map((i) => i.getAttribute('data-chamber'))).toEqual(CHAMBERS.map((c) => c.key));
    for (const [i, c] of CHAMBERS.entries()) {
      const el = items[i]!;
      if (c.live) {
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
});
