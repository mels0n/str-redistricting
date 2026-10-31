/** Title, description and path of each fixed page: the one source for document titles and the prerendered head. */
export interface PageMeta {
  title: string;
  description: string;
  path: string;
  /** True for a page kept out of search results and the sitemap. */
  noindex?: boolean;
}

export const PAGE_META = {
  home: {
    path: '/',
    title: 'Fair Maps: districts drawn by a rule',
    description: 'Gerrymandering lets politicians pick their voters. Fair Maps draws every state’s districts by one open rule that never sees party, race or past votes.',
  },
  act: {
    path: '/act',
    title: 'Take action | Fair Maps',
    description: 'Find who represents you, email all of your representatives at once, and add your name to the people asking for districts drawn by one open rule.',
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
    title: 'Sites that show the Fair Maps badge | Fair Maps',
    description: 'Websites that show the Fair Maps badge, each with a link to the page where it appears, and how to add the badge to yours. We check each site about once a day.',
  },
  privacy: {
    path: '/privacy',
    title: 'Privacy | Fair Maps',
    description: 'What Fair Maps collects when you add your name, what it never keeps, what is public, how visits are counted without cookies, and how to be removed at any time.',
  },
  badges: {
    path: '/badges',
    title: 'Badges for candidates | Fair Maps',
    description: 'Free badges for a campaign site: a crest, a seal, a pledge, a button and one with your state’s map. Copy the code or download the image. No script.',
  },
  remove: {
    path: '/remove',
    title: 'Remove your signature | Fair Maps',
    description: 'Remove your signature, your note and your email from Fair Maps for good.',
    noindex: true,
  },
  confirm: {
    path: '/confirm',
    title: 'Confirm your signature | Fair Maps',
    description: 'Confirm your signature for Fair Maps.',
    noindex: true,
  },
} as const satisfies Record<'home' | 'act' | 'how' | 'faq' | 'changelog' | 'pledges' | 'privacy' | 'badges' | 'remove' | 'confirm', PageMeta>;
