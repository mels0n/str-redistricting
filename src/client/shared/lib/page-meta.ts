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
  pledges: {
    path: '/pledges',
    title: 'Who supports the Fair Maps rule | Fair Maps',
    description: 'Officeholders and candidates who have publicly pledged to support drawing districts with the Fair Maps rule, each with a link to their own statement.',
  },
  privacy: {
    path: '/privacy',
    title: 'Privacy | Fair Maps',
    description: 'What Fair Maps collects when you add your name, what it never keeps, what is public, and how to be removed at any time.',
  },
} as const satisfies Record<'home' | 'how' | 'faq' | 'changelog' | 'pledges' | 'privacy', PageMeta>;
