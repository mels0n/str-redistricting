import { h, formatHash, NATIONAL } from '../../shared';

export function createSiteHeader(): HTMLElement {
  return h(
    'header',
    { class: 'strv-masthead' },
    h('a', { href: formatHash(NATIONAL), class: 'strv-masthead__title' }, 'House districts drawn by rule'),
    h('p', { class: 'strv-masthead__credit' }, 'from Save the Republic'),
  );
}
