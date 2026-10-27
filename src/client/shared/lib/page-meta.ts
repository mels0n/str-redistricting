/** Title, description and path of each fixed page: the one source for document titles and the prerendered head. */
export interface PageMeta {
  title: string;
  description: string;
  path: string;
}

export const PAGE_META = {
  home: {
    path: '/',
    title: 'Fair Maps: districts drawn by a rule',
    description: 'Gerrymandering lets politicians pick their voters. Fair Maps draws every state’s districts by one open rule that never sees party, race or past votes.',
  },
  how: {
    path: '/how',
    title: 'How the districts are drawn | Fair Maps',
    description: 'The shortest splitline rule, step by step: cut each state along the shortest line that splits its people evenly, keep census blocks whole, then balance.',
  },
  faq: {
    path: '/faq',
    title: 'FAQ | Fair Maps',
    description: 'Plain answers on gerrymandering, how districts are drawn today, and how one fixed, partisan-blind rule draws every state’s map from census counts alone.',
  },
  changelog: {
    path: '/changelog',
    title: 'Changelog | Fair Maps',
    description: 'Every release of the Fair Maps engine, census input, published maps and website, and what changed in each.',
  },
  privacy: {
    path: '/privacy',
    title: 'Privacy | Fair Maps',
    description: 'What Fair Maps counts and keeps: cookie-free visit totals, address lookups sent straight to the Census Bureau, and nothing else.',
  },
} as const satisfies Record<'home' | 'how' | 'faq' | 'changelog' | 'privacy', PageMeta>;
