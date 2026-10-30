import { h, clear, config, PAGE_META, routeHref, iconArrowLeft, NATIONAL, type Page } from '../../shared';
import { loadBadgeSites, type BadgeSite } from '../../entities/badge-sites';

/** What to paste into a page. The image comes from our function, which is how we learn which site shows it. */
export const BADGE_SNIPPET = `<a href="https://${config.siteHost}/pledges"><img src="https://${config.siteHost}/api/badge" alt="I back Fair Maps" width="200" height="40"></a>`;

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
        null,
        h('h2', null, 'Show the badge on your site'),
        h('p', null, h('img', { src: '/badge.svg', alt: 'I back Fair Maps', width: '200', height: '40' })),
        h('pre', { class: 'strv-pledges__snippet' }, h('code', null, BADGE_SNIPPET)),
        h('p', null, `Add the badge to your home page and link it to ${config.siteHost}/pledges. It usually shows up within minutes, otherwise within a day.`),
        h('p', null, 'Put it on your home page. We check each site about once a day; if the badge is gone for two daily checks, the site comes off the list.'),
        h('p', null, 'Older snippets that point at /badge.svg are not noticed. Use the snippet above.'),
        h(
          'p',
          null,
          `What we look for: the badge image (${config.siteHost}/api/badge) and a link to ${config.siteHost} on the same page. Either wrap the image in a link, as above, or keep the image and add a link to us anywhere else on the page. The image has to be in the page’s own HTML (an `,
          h('code', null, '<img>'),
          ' tag), not added by a script.',
        ),
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
