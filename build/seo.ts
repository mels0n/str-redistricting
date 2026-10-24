import { PAGE_META } from '../src/client/shared/lib/page-meta';
import { FAQ_QUESTIONS } from '../src/client/shared/lib/route';
import { jsonLd as graphFor, jsonLdScript, type FaqEntry, type PageKey } from './structured-data';

export { jsonLdScript };
export type { FaqEntry, PageKey };

/** Every fixed page, in the order PAGE_META lists them: the one list the sitemap and the prerender both walk. */
/** The structured data each prerendered page carries; the FAQ entries feed the FAQ page's `FAQPage`, matched to the questions by position. */
export const jsonLd = (key: PageKey, faq: readonly FaqEntry[]): ReturnType<typeof graphFor> => graphFor(key, faq, FAQ_QUESTIONS);

export const PAGE_KEYS = Object.keys(PAGE_META) as PageKey[];

export function sitemapXml(site: string): string {
  const urls = PAGE_KEYS.map((k) => `  <url><loc>${site}${PAGE_META[k].path}</loc></url>`);
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
