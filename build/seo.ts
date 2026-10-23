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

/** The JSON-LD script tag for a page, or an empty string when it has none. `<` is escaped so no value can close the tag. */
export function jsonLdScript(objects: readonly object[]): string {
  if (objects.length === 0) return '';
  const json = JSON.stringify(objects.length === 1 ? objects[0] : objects).replace(/</g, String.fromCharCode(92) + 'u003c');
  return `<script type="application/ld+json">${json}</script>`;
}
