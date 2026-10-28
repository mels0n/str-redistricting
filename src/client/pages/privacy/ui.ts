import { h, PAGE_META, feedbackHref, routeHref, iconArrowLeft, NATIONAL, type Page } from '../../shared';

const p = (...children: (Node | string)[]): HTMLElement => h('p', null, ...children);
const link = (href: string, text: string): HTMLElement => h('a', { href }, text);
const ul = (...items: (Node | string)[]): HTMLElement => h('ul', null, ...items.map((i) => h('li', null, i)));

function section(id: string, title: string, ...body: HTMLElement[]): HTMLElement {
  return h('section', { class: 'strv-how__section', id: `strv-privacy-${id}`, 'aria-labelledby': `strv-privacy-${id}-h` }, h('h2', { class: 'strv-how__h2', id: `strv-privacy-${id}-h` }, title), ...body);
}

const SERVICES = ['Supabase (database)', 'Vercel (hosting and visit counts)', 'Cloudflare Turnstile (bot check, which sees your IP address as you sign)', 'Resend (delivers our emails to you)', 'the U.S. Census Bureau geocoder (receives your address, only if you give one, to find your district)'];

/** What the site collects, counts, keeps and sends, with and without the sign-on. Every sentence has to stay true of the code: change one with the other. */
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
      h('p', { class: 'strv-how__lede' }, 'Fair Maps has no accounts and no ads, and adding your name is optional. This page lists what happens to your information when you add your name, and everything the site counts, keeps in your browser, or sends anywhere else.'),
    ),
    h(
      'div',
      { class: 'strv-how__body' },
      section(
        'collect',
        'What we collect',
        ul(
          'A one-way hash of your email, so the same email counts once.',
          'Your email itself, kept encrypted, only if you tick the box for updates. If you don’t, it is held encrypted only while your confirmation email waits to be sent, and it is deleted once the email is sent.',
          'Your state, and the codes of your districts (U.S. House, State House, State Senate) if you gave an address. Without an address you are counted in your state only.',
          'A display name and your town, only if you give a name and tick the box to show it.',
          'A note, if you write one. It is kept encrypted. Software checks it when you sign, and a note with a link, contact details or words we don’t allow is dropped and never stored.',
          'A hash of your IP address (for an IPv6 address, of its network part), kept for one to two days to limit how often one place can sign.',
        ),
        p('Sign-ups that are never confirmed are deleted automatically about a week after the link in their confirmation email expires. If the email never went out, for example because the address was refused, the sign-up is deleted about nine days after your last attempt (at once when the address is refused outright). A sign-up whose confirmation email is still waiting to be sent is kept until the email goes out, so a delay on our side never costs you your place. While it waits, your email address is stored sealed (encrypted) in a queue, and it is deleted when the email is sent.'),
      ),
      section('never', 'What we never keep', p('Your address. It is optional. If you give one, we send it to the U.S. Census Bureau geocoder once to find your district, and it is not stored or logged by us.')),
      section(
        'public',
        'What is public',
        ul('Counts of people who signed in each district.', 'Your name and town, only if you tick the box.', 'Your note, only after we have read and approved it, and only if you ticked the box to show your name and town.'),
      ),
      section('email', 'Who sees your email', p('Only us and Resend, the service that delivers our emails, and only to send the confirmation and the updates you asked for. Resend keeps its own logs of the messages it sends, under its own policy.')),
      section(
        'removal',
        'How to be removed',
        p(link('/remove', 'Remove your signature'), ' any time. You get an email with a link, and one click deletes your signature, your note and your email from the database for good. Your district’s count drops by one.'),
      ),
      section('services', 'Services we use', ul(...SERVICES)),
      section(
        'visits',
        'Visit counts',
        p('The site counts visits with Vercel Web Analytics, from the company that hosts it. For each page view it records the page’s path (never the part of the address after a ? or #, where other sites add tracking codes), the site that linked to it, and the visitor’s country, browser, operating system and kind of device.'),
        p('It sets no cookies and stores nothing in your browser. Visitors are told apart only by a code worked out from each request, and that code is discarded after 24 hours, so a visit can’t be tied to a person or followed from one day to the next or from site to site. Only totals are ever shown. If an ad blocker stops the count, the site works the same.'),
      ),
      section(
        'address',
        'Address lookups',
        p('When you look up an address to find your districts, your browser sends it straight to the U.S. Census Bureau’s geocoder, which answers with a point on the map. The lookup never passes through Fair Maps and the site doesn’t keep it. What the Census Bureau does with the request is covered by ', link('https://www.census.gov/about/policies/privacy.html', 'its privacy policy'), '.'),
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
        p('Fair Maps sets no cookies, shows no ads or social media buttons, loads no outside fonts and does no tracking across sites. The maps and data all load from this site, and the only other services involved are the ones named on this page. Questions about any of this are welcome: ', link(feedbackHref('question'), 'ask on GitHub'), '.'),
      ),
    ),
  );
  document.title = PAGE_META.privacy.title;
  return { el, focusTarget: () => h1, destroy() {} };
}
