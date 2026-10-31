import { PAGE_META, type PageMeta } from '../src/client/shared/lib/page-meta';
import { CODE_LICENSE_NAME, CREDIT_TEXT, DATA_LICENSE_NAME, REPO_URL, jsonLd, jsonLdScript, type FaqEntry, type PageKey } from './structured-data';

export { jsonLd, jsonLdScript };
export type { FaqEntry, PageKey };

/** Every fixed page, in the order PAGE_META lists them: the one list the sitemap and the prerender both walk. */
export const PAGE_KEYS = Object.keys(PAGE_META) as PageKey[];

/** The fixed pages that are indexable, then each share page path (`CO`, `CO/house`) the published index calls for. */
export function sitemapXml(site: string, sharePaths: readonly string[]): string {
  const paths = [...PAGE_KEYS.filter((k) => !(PAGE_META[k] as PageMeta).noindex).map((k) => PAGE_META[k].path), ...sharePaths.map((p) => `/${p}`)];
  const urls = paths.map((p) => `  <url><loc>${site}${p}</loc></url>`);
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
- [Sites that show the Fair Maps badge](${site}/pledges): websites verified to show the badge, each with a link to the page where it appears, and how to add it to yours
- [Badges for candidates](${site}/badges): free badges for a campaign site, with the code to paste and images to download
- [Take action](${site}/act): find your representatives, email all of them at once, and add your name
- [Privacy](${site}/privacy): what is collected when someone adds their name, what is never kept, and how to be removed

## Maps
- [Every state's map](${site}/): Federal House for all 50 states, State House and State Senate where the chamber exists; find your district by address
- [Map data index](${site}/data/index.json): published district plans, ${DATA_LICENSE_NAME}, credit "${CREDIT_TEXT}"

## Source
- [Source code](${REPO_URL}): ${CODE_LICENSE_NAME}; reproduce any state's map
- [Full text for language models](${site}/llms-full.txt)
`;
}
