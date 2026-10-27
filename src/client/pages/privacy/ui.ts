import { h, PAGE_META, routeHref, iconArrowLeft, NATIONAL, type Page } from '../../shared';

interface Section {
  heading: string;
  body: (HTMLElement | string)[];
}

const SERVICES = ['Supabase (database)', 'Vercel (hosting)', 'Cloudflare Turnstile (bot check)', 'Resend (sending email)', 'the U.S. Census Bureau geocoder (finding your district)'];

/** What the sign-on collects, keeps and shows. Every line here describes what the code does today. */
const SECTIONS = (): Section[] => [
  {
    heading: 'What we collect',
    body: [
      h(
        'ul',
        null,
        h('li', null, 'A one-way hash of your email, so the same email counts once.'),
        h('li', null, 'Your email itself, kept encrypted, only if you tick the box for updates. If you don’t, it is held encrypted only while your confirmation email waits to be sent, and it is deleted once the email is sent.'),
        h('li', null, 'The codes of your districts (U.S. House, State House, State Senate).'),
        h('li', null, 'A display name and your town, only if you give a name and tick the box to show it.'),
        h('li', null, 'A note, if you write one.'),
        h('li', null, 'A hash of your IP address, kept for 24 hours to limit how often one place can sign.'),
      ),
      'Sign-ups that are never confirmed are deleted automatically after a few weeks.',
    ],
  },
  {
    heading: 'What we never keep',
    body: ['Your address. We use it once to find your district, and it is not stored or logged.'],
  },
  {
    heading: 'What is public',
    body: [
      h(
        'ul',
        null,
        h('li', null, 'Counts of people who signed in each district.'),
        h('li', null, 'Your name and town, only if you tick the box.'),
        h('li', null, 'Your note, only if you tick the box and we approve it.'),
      ),
    ],
  },
  {
    heading: 'What goes to your representative',
    body: ['Your note, only if you tick that box.'],
  },
  {
    heading: 'Who sees your email',
    body: ['Only us, to send the updates you asked for.'],
  },
  {
    heading: 'How to be removed',
    body: [
      h('p', null, 'Go to ', h('a', { href: '/remove' }, '/remove'), ' any time. You get an email with a link, and one click deletes your signature, your note and your email from the database for good. Your district’s count drops by one.'),
    ],
  },
  {
    heading: 'Services we use',
    body: [h('ul', null, SERVICES.map((s) => h('li', null, s)))],
  },
];

/** The privacy page. */
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
      h('p', { class: 'strv-how__lede' }, 'What happens to your information when you add your name to Fair Maps.'),
    ),
    h(
      'div',
      { class: 'strv-privacy__body' },
      SECTIONS().map((s) => h('section', null, h('h2', null, s.heading), s.body.map((b) => (typeof b === 'string' ? h('p', null, b) : b)))),
    ),
  );
  document.title = PAGE_META.privacy.title;
  return { el, focusTarget: () => h1, destroy() {} };
}
