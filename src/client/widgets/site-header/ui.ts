import { h, formatHash, faqRoute, howRoute, stateRoute, nationalRoute, NATIONAL, CHAMBERS, type Chamber, type Route } from '../../shared';

const FEDERAL_ONLY: ReadonlySet<Chamber> = new Set<Chamber>(['federal-house']);

/** The chamber a route is about; pages that are not about a map stay on the federal House, as before. */
function routeChamber(route: Route): Chamber {
  return route.page === 'state' || route.page === 'national' ? route.chamber : 'federal-house';
}

/** Where a chamber's link goes: the same state in that chamber, or that chamber's national map. */
function chamberHref(route: Route, chamber: Chamber): string {
  return formatHash(route.page === 'state' ? stateRoute(route.abbr, { chamber }) : nationalRoute(chamber));
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

export function createSiteHeader(): HTMLElement {
  return h(
    'header',
    { class: 'strv-masthead' },
    h('a', { href: formatHash(NATIONAL), class: 'strv-masthead__title' }, 'Fair Maps'),
    createChamberSwitch(),
    h(
      'nav',
      { class: 'strv-masthead__nav', 'aria-label': 'Site' },
      h('a', { href: formatHash(howRoute()), class: 'strv-masthead__link', 'data-nav': 'how' }, 'How it works'),
      h('a', { href: formatHash(faqRoute()), class: 'strv-masthead__link', 'data-nav': 'faq' }, 'FAQ'),
    ),
    h('p', { class: 'strv-masthead__credit' }, 'by Chris Melson'),
  );
}
