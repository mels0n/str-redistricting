import { h, formatHash, howRoute, NATIONAL } from '../../shared';

export function createSiteHeader(): HTMLElement {
  return h(
    'header',
    { class: 'strv-masthead' },
    h('a', { href: formatHash(NATIONAL), class: 'strv-masthead__title' }, 'House districts drawn by rule'),
    h('nav', { class: 'strv-masthead__nav', 'aria-label': 'Site' }, h('a', { href: formatHash(howRoute()), class: 'strv-masthead__link', 'data-nav': 'how' }, 'How it works')),
    h('p', { class: 'strv-masthead__credit' }, 'from Save the Republic'),
  );
}
