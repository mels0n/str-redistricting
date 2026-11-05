import { h, clear, PAGE_META, routeHref, iconArrowLeft, NATIONAL, BADGES, type Page } from '../../shared';
import { loadBadgeSites, type BadgeSite } from '../../entities/badge-sites';

export const LEDE = 'These websites show our badge. Each entry links to the page where it appears. Showing the badge is the only thing we check. Party is not shown.';
export const EMPTY_COPY = 'No sites show the badge yet.';
export const FAILED_COPY = 'We couldn’t load the list. Try again later.';
/** What the static page says before the list arrives (it is fetched in the browser). */
export const LOADING_COPY = 'The list of sites is shown here.';

function siteRow(s: BadgeSite): HTMLElement {
  // The bold label is the representative's name when the site is theirs, else the host. The page's own title is untrusted text: smaller, and only ever text.
  return h(
    'li',
    { class: 'strv-pledges__row' },
    h('strong', null, s.name ?? s.host),
    s.name !== null && s.office !== null && h('span', { class: 'strv-pledges__seat' }, s.office),
    s.title !== null && h('small', { class: 'strv-pledges__title' }, s.title),
    h('a', { href: s.url, rel: 'noopener' }, 'View the page'),
  );
}

/** The page of sites that show the badge. Tests hand the list in; in the browser it is fetched, and prerendering shows only the fixed text. */
export function createPledgesPage(preloaded?: readonly BadgeSite[]): Page {
  const h1 = h('h1', { class: 'strv-how__h1', tabindex: -1 }, 'Sites that show the Fair Maps badge');
  const listSlot = h('div', { class: 'strv-pledges__list' });
  let dead = false;

  const fill = (sites: readonly BadgeSite[]): void => {
    clear(listSlot);
    if (sites.length === 0) {
      listSlot.append(h('p', { class: 'strv-pledges__empty' }, EMPTY_COPY));
      return;
    }
    listSlot.append(h('ul', { class: 'strv-pledges__ul' }, sites.map(siteRow)));
  };

  if (preloaded) fill(preloaded);
  else {
    listSlot.append(h('p', { class: 'strv-pledges__empty' }, LOADING_COPY));
    void loadBadgeSites().then((sites) => {
      if (dead) return;
      if (sites === null) {
        clear(listSlot);
        listSlot.append(h('p', { class: 'strv-pledges__empty' }, FAILED_COPY));
      } else fill(sites);
    });
  }

  const el = h(
    'main',
    { class: 'strv-how strv-pledges', id: 'strv-main' },
    h(
      'header',
      { class: 'strv-how__head' },
      h('a', { href: routeHref(NATIONAL), class: 'strv-back' }, iconArrowLeft(), 'All states'),
      h1,
      h('p', { class: 'strv-how__lede' }, LEDE),
    ),
    h(
      'div',
      { class: 'strv-pledges__body' },
      listSlot,
      h(
        'section',
        { class: 'strv-pledges__add' },
        h('h2', null, 'Show the badge on your site'),
        h('p', null, 'Pick a badge, copy its code into your page, and your site joins this list.'),
        h('p', null, h('a', { href: routeHref(BADGES), class: 'strv-pledges__cta' }, 'Choose a badge')),
      ),
    ),
  );
  document.title = PAGE_META.pledges.title;
  return {
    el,
    focusTarget: () => h1,
    destroy() {
      dead = true;
    },
  };
}
