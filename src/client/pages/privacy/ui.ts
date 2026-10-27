import { h, PAGE_META, config, routeHref, iconArrowLeft, NATIONAL, type Page } from '../../shared';

const p = (...children: (Node | string)[]): HTMLElement => h('p', null, ...children);
const link = (href: string, text: string): HTMLElement => h('a', { href }, text);

function section(id: string, title: string, ...body: HTMLElement[]): HTMLElement {
  return h('section', { class: 'strv-how__section', id: `strv-privacy-${id}`, 'aria-labelledby': `strv-privacy-${id}-h` }, h('h2', { class: 'strv-how__h2', id: `strv-privacy-${id}-h` }, title), ...body);
}

/** What the site counts, keeps and sends. Every sentence has to stay true of the code: change one with the other. */
export function createPrivacyPage(): Page {
  const h1 = h('h1', { class: 'strv-how__h1', tabindex: -1 }, 'Privacy');
  const el = h(
    'main',
    { class: 'strv-how strv-privacy', id: 'strv-main' },
    h(
      'header',
      { class: 'strv-how__head' },
      h('a', { href: routeHref(NATIONAL), class: 'strv-back' }, iconArrowLeft(), 'All states'),
      h1,
      h('p', { class: 'strv-how__lede' }, 'Fair Maps has no accounts, no sign-up and no ads. This page lists everything the site counts, keeps in your browser, or sends anywhere else.'),
    ),
    h(
      'div',
      { class: 'strv-how__body' },
      section(
        'visits',
        'Visit counts',
        p('The site counts visits with Vercel Web Analytics, from the company that hosts it. For each page view it records the page, the site that linked to it, and the visitor’s country, browser, operating system and kind of device.'),
        p('It sets no cookies and stores nothing in your browser. Visitors are told apart only by a code worked out from each request, and that code is discarded after 24 hours, so a visit can’t be tied to a person or followed from one day to the next or from site to site. Only totals are ever shown. If an ad blocker stops the count, the site works the same.'),
      ),
      section(
        'address',
        'Address lookups',
        p('When you look up an address, your browser sends it straight to the U.S. Census Bureau’s geocoder, which answers with a point on the map. The address never passes through Fair Maps and the site doesn’t keep it. What the Census Bureau does with the request is covered by ', link('https://www.census.gov/about/policies/privacy.html', 'its privacy policy'), '.'),
      ),
      section(
        'browser',
        'Kept in your browser',
        p('If you drag a panel divider to resize it, the size is kept in your browser’s local storage so it stays that way next time. If a new release of the maps goes out while a page is open, the site reloads once and notes that in session storage so it doesn’t reload again. Neither is sent anywhere.'),
      ),
      section(
        'hosting',
        'Hosting',
        p('The site is hosted by Vercel. Like any web host, its servers see the IP address of each request in order to answer it, and may keep short-lived logs to run and protect the service, under ', link('https://vercel.com/legal/privacy-policy', 'Vercel’s privacy policy'), '.'),
        p('Pages send no referrer, so when you follow a link away from Fair Maps the next site isn’t told where you came from.'),
      ),
      section(
        'else',
        'Nothing else',
        p('There are no cookies, ads, social media buttons or outside fonts, and no tracking across sites. The maps, data and fonts all load from this site. Questions about any of this can go to the ', link(`${config.repoUrl}/issues`, 'project’s issue tracker'), '.'),
      ),
    ),
  );
  document.title = PAGE_META.privacy.title;
  return { el, focusTarget: () => h1, destroy() {} };
}
