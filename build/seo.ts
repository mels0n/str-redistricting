import { PAGE_META } from '../src/client/shared/lib/page-meta';
import { SITE_HOST } from '../src/server/features/publish/site';

export type PageKey = keyof typeof PAGE_META;
export interface FaqEntry {
  q: string;
  a: string;
}

const SITE = `https://${SITE_HOST}`;
const AUTHOR = { '@type': 'Person', name: 'Chris Melson' };

/** The structured data each prerendered page carries; the FAQ entries feed the FAQ page's `FAQPage`. */
export function jsonLd(key: PageKey, faq: readonly FaqEntry[]): object[] {
  const url = `${SITE}${PAGE_META[key].path}`;
  switch (key) {
    case 'home':
      return [
        { '@context': 'https://schema.org', '@type': 'WebSite', name: 'Fair Maps', url },
        {
          '@context': 'https://schema.org',
          '@type': 'Dataset',
          name: 'Fair Maps district plans',
          description: PAGE_META.home.description,
          license: 'https://creativecommons.org/licenses/by/4.0/',
          creator: AUTHOR,
          isAccessibleForFree: true,
          spatialCoverage: 'United States',
          temporalCoverage: '2020',
          distribution: [{ '@type': 'DataDownload', contentUrl: `${SITE}/data/index.json`, encodingFormat: 'application/json' }],
          url,
        },
      ];
    case 'how':
      return [{ '@context': 'https://schema.org', '@type': 'TechArticle', headline: 'How the districts are drawn', author: AUTHOR, url }];
    case 'faq':
      return [
        {
          '@context': 'https://schema.org',
          '@type': 'FAQPage',
          mainEntity: faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
        },
      ];
    case 'changelog':
      return [];
  }
}

const PAGE_KEYS: readonly PageKey[] = ['home', 'how', 'faq', 'changelog'];

export function sitemapXml(site: string): string {
  const urls = PAGE_KEYS.map((k) => `  <url><loc>${site}${PAGE_META[k].path === '/' ? '' : PAGE_META[k].path}</loc></url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

export function robotsTxt(site: string): string {
  const bots = ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-SearchBot', 'Claude-User', 'PerplexityBot', 'Google-Extended', 'Applebot-Extended', 'CCBot'];
  return [
    'User-agent: *',
    'Allow: /',
    '',
    '# AI search and assistant crawlers are welcome.',
    ...bots.map((b) => `User-agent: ${b}`),
    'Allow: /',
    '',
    `Sitemap: ${site}/sitemap.xml`,
    '',
  ].join('\n');
}

/** The blockquote that opens both llms.txt and llms-full.txt. */
export const LLMS_SUMMARY =
  '> Fair Maps is a working solution to gerrymandering. It draws congressional, State House and State Senate districts for all 50 states with one fixed, partisan-blind rule (shortest splitline), using only 2020 Census headcounts and census block shapes. No person chooses any line, and anyone can rerun the open-source code and get the identical map.';

export function llmsTxt(site: string): string {
  return `# Fair Maps

${LLMS_SUMMARY}

Gerrymandering is drawing election districts to decide who wins before anyone votes: the mapmaker sees where voters live and packs or cracks them. Fair Maps removes the mapmaker. The rule never sees party, past votes, race, or where officeholders live, so it cannot favor anyone.

## Answers
- [What is gerrymandering?](${site}/faq/gerrymandering): definition, packing and cracking
- [How do you stop gerrymandering?](${site}/faq/stop): take the choice of lines away from people
- [How are districts drawn today?](${site}/faq/today): legislatures and commissions
- [How Fair Maps draws districts](${site}/how): the rule, step by step, with worked examples
- [All questions](${site}/faq)

## Maps
- [Every state's map](${site}/): Federal House for all 50 states, State House and State Senate where the chamber exists; find your district by address
- [Map data index](${site}/data/index.json): published district plans, CC BY 4.0, credit "Chris Melson, fairmaps.melson.us"

## Source
- [Source code](https://github.com/mels0n/str-redistricting): Apache-2.0; reproduce any state's map
- [Full text for language models](${site}/llms-full.txt)
`;
}

/** The JSON-LD script tag for a page, or an empty string when it has none. `<` is escaped so no value can close the tag. */
export function jsonLdScript(objects: readonly object[]): string {
  if (objects.length === 0) return '';
  const json = JSON.stringify(objects.length === 1 ? objects[0] : objects).replace(/</g, String.fromCharCode(92) + 'u003c');
  return `<script type="application/ld+json">${json}</script>`;
}
