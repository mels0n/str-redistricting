import { h, svg, config, formatHash, faqRoute, howRoute, stateRoute, NATIONAL, CHAMBERS, type Route } from '../../shared';

/**
 * Which body the maps are drawn for, for the state on screen. Chambers without maps yet show as coming soon and
 * are not links; the title is the way home.
 */
function createChamberSwitch(): HTMLElement {
  return h(
    'div',
    { class: 'strv-chamber', role: 'group', 'aria-label': 'Chamber' },
    CHAMBERS.map((c) =>
      c.live
        ? h('a', { href: formatHash(NATIONAL), class: 'strv-chamber__item', 'aria-current': 'true', 'data-chamber': c.key }, c.label)
        : h('span', { class: 'strv-chamber__item strv-chamber__item--soon', 'data-chamber': c.key }, c.label, h('span', { class: 'strv-chamber__soon' }, ' Soon')),
    ),
  );
}

/** Points the live chamber at the state on screen, so switching chambers keeps the state; off a state page it opens the national map. */
export function syncChamberSwitch(route: Route): void {
  const href = formatHash(route.page === 'state' ? stateRoute(route.abbr) : NATIONAL);
  for (const c of CHAMBERS) {
    if (c.live) document.querySelector(`.strv-masthead [data-chamber="${c.key}"]`)?.setAttribute('href', href);
  }
}

/** The GitHub mark, drawn in the link's text color. */
function githubMark(): SVGSVGElement {
  return svg(
    'svg',
    { viewBox: '0 0 16 16', width: 18, height: 18, fill: 'currentColor', 'aria-hidden': 'true', focusable: 'false' },
    svg('path', {
      d: 'M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z',
    }),
  );
}

export function createSiteHeader(): HTMLElement {
  return h(
    'header',
    { class: 'strv-masthead' },
    h('a', { href: formatHash(NATIONAL), class: 'strv-masthead__title' }, 'Fair Maps'),
    createChamberSwitch(),
    h(
      'nav',
      { class: 'strv-masthead__nav', 'aria-label': 'Site' },
      h('a', { href: formatHash(faqRoute()), class: 'strv-masthead__link', 'data-nav': 'faq' }, 'FAQ'),
      h('a', { href: formatHash(howRoute()), class: 'strv-masthead__link', 'data-nav': 'how' }, 'How it works'),
      h(
        'a',
        { href: config.repoUrl, class: 'strv-masthead__link strv-masthead__repo', 'aria-label': 'Source code on GitHub', title: 'Source code on GitHub' },
        githubMark(),
      ),
    ),
    h('p', { class: 'strv-masthead__credit' }, 'by Chris Melson'),
  );
}
