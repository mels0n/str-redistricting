import { h, formatHash, howRoute, NATIONAL, CHAMBERS } from '../../shared';

/** Which body the maps are drawn for. Chambers without maps yet show as coming soon and are not links. */
function createChamberSwitch(): HTMLElement {
  return h(
    'div',
    { class: 'strv-chamber', role: 'group', 'aria-label': 'Chamber' },
    CHAMBERS.map((c) =>
      c.live
        ? h('a', { href: formatHash(NATIONAL), class: 'strv-chamber__item', 'aria-current': 'true', 'data-chamber': c.key }, c.label)
        : h(
            'span',
            { class: 'strv-chamber__item', 'aria-disabled': 'true', 'data-chamber': c.key },
            c.label,
            h('span', { class: 'strv-chamber__soon' }, ' Soon'),
          ),
    ),
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
      h('a', { href: formatHash(NATIONAL), class: 'strv-masthead__link', 'data-nav': 'states' }, 'All states'),
      h('a', { href: formatHash(howRoute()), class: 'strv-masthead__link', 'data-nav': 'how' }, 'How it works'),
    ),
    h('p', { class: 'strv-masthead__credit' }, 'by Chris Melson'),
  );
}
