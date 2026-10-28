import { h, svg, config, routeHref, actRoute, faqRoute, howRoute, stateRoute, nationalRoute, NATIONAL, CHAMBERS, type Chamber, type Route } from '../../shared';

const FEDERAL_ONLY: ReadonlySet<Chamber> = new Set<Chamber>(['federal-house']);

/** The chamber a route is about; pages that are not about a map stay on the federal House, as before. */
function routeChamber(route: Route): Chamber {
  return route.page === 'state' || route.page === 'national' ? route.chamber : 'federal-house';
}

/** Where a chamber's link goes: the same state in that chamber, or that chamber's national map. */
function chamberHref(route: Route, chamber: Chamber): string {
  return routeHref(route.page === 'state' ? stateRoute(route.abbr, { chamber }) : nationalRoute(chamber));
}

function chamberItems(route: Route, live: ReadonlySet<Chamber>): HTMLElement[] {
  const current = routeChamber(route);
  return CHAMBERS.map((c) =>
    // The chamber on screen stays a link (and the current item) even before the index says whether it is live.
    live.has(c.key) || c.key === current
      ? h('a', { href: chamberHref(route, c.key), class: 'strv-chamber__item', ...(c.key === current && { 'aria-current': 'true' }), 'data-chamber': c.key }, c.label)
      : h('span', { class: 'strv-chamber__item strv-chamber__item--soon', 'data-chamber': c.key }, c.label, h('span', { class: 'strv-chamber__soon' }, ' Soon')),
  );
}

/**
 * Which body the maps are drawn for, for the state on screen. Chambers without maps yet show as coming soon and
 * are not links; the title is the way home.
 */
function createChamberSwitch(): HTMLElement {
  return h('div', { class: 'strv-chamber', role: 'group', 'aria-label': 'Chamber' }, chamberItems(NATIONAL, FEDERAL_ONLY));
}

/**
 * Shows which chambers have maps and points each at the state on screen, so switching chambers keeps the state; off a
 * state page it opens that chamber's national map. `live` comes from the index (see liveChambers).
 */
export function syncChamberSwitch(route: Route, live: ReadonlySet<Chamber> = FEDERAL_ONLY): void {
  const group = document.querySelector('.strv-masthead .strv-chamber');
  if (!group) return;
  // Keep focus on the link the visitor used: rebuild only when the set of links changed, otherwise update in place.
  const items = [...group.querySelectorAll<HTMLElement>('[data-chamber]')];
  const shape = items.map((i) => `${i.getAttribute('data-chamber')}:${i.tagName}`).join();
  const onScreen = routeChamber(route);
  const wanted = CHAMBERS.map((c) => `${c.key}:${live.has(c.key) || c.key === onScreen ? 'A' : 'SPAN'}`).join();
  if (shape !== wanted) {
    group.replaceChildren(...chamberItems(route, live));
    return;
  }
  const current = routeChamber(route);
  for (const item of items) {
    const key = item.getAttribute('data-chamber') as Chamber;
    if (item.tagName !== 'A') continue;
    item.setAttribute('href', chamberHref(route, key));
    if (key === current) item.setAttribute('aria-current', 'true');
    else item.removeAttribute('aria-current');
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
    h('a', { href: routeHref(NATIONAL), class: 'strv-masthead__title' }, 'Fair Maps'),
    createChamberSwitch(),
    h(
      'nav',
      { class: 'strv-masthead__nav', 'aria-label': 'Site' },
      h('a', { href: routeHref(actRoute()), class: 'strv-masthead__link strv-masthead__act', 'data-nav': 'act' }, 'Take action'),
      h('a', { href: routeHref(faqRoute()), class: 'strv-masthead__link', 'data-nav': 'faq' }, 'FAQ'),
      h('a', { href: routeHref(howRoute()), class: 'strv-masthead__link', 'data-nav': 'how' }, 'How it works'),
      h(
        'a',
        { href: config.repoUrl, class: 'strv-masthead__link strv-masthead__repo', 'aria-label': 'Source code on GitHub', title: 'Source code on GitHub' },
        githubMark(),
      ),
    ),
  );
}
