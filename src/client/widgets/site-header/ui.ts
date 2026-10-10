import { h, formatHash, howRoute, stateRoute, NATIONAL, CHAMBERS, type Route } from '../../shared';

/**
 * Which body the maps are drawn for, for the state on screen. Chambers without maps yet show as coming soon and
 * are not links; the title and All states are the way home.
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

export function createSiteHeader(): HTMLElement {
  return h(
    'header',
    { class: 'strv-masthead' },
    h('a', { href: formatHash(NATIONAL), class: 'strv-masthead__title' }, 'Fair Maps'),
    createChamberSwitch(),
    h(
      'nav',
      { class: 'strv-masthead__nav', 'aria-label': 'Site' },
      h('a', { href: formatHash(NATIONAL), class: 'strv-masthead__link', 'data-nav': 'states' }, 'All states'),
      h('a', { href: formatHash(howRoute()), class: 'strv-masthead__link', 'data-nav': 'how' }, 'How it works'),
    ),
    h('p', { class: 'strv-masthead__credit' }, 'by Chris Melson'),
  );
}
