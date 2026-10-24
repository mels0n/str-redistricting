import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PAGE_META } from '../src/client/shared/lib/page-meta.js';
// Imported from the file, not the publish slice's index, so the Vite config does not load the image renderer.
import { SITE_HOST } from '../src/server/features/publish/site.js';

export type PageKey = keyof typeof PAGE_META;
export interface FaqEntry {
  q: string;
  a: string;
}
/** One schema.org node. */
export type Node = Record<string, unknown>;
export interface Graph {
  '@context': 'https://schema.org';
  '@graph': Node[];
}

const SITE = `https://${SITE_HOST}`;
const REPO = 'https://github.com/mels0n/str-redistricting';
const CENSUS_URL = 'https://www.census.gov/programs-surveys/decennial-census/about/rdo.html';
const OG_IMAGE = { '@type': 'ImageObject', url: `${SITE}/og-image.png`, width: 1200, height: 630 };

/** The stable `@id` of each entity every page can point at. */
export const ID = {
  author: `${SITE}/#author`,
  website: `${SITE}/#website`,
  census: `${SITE}/#census-data`,
  source: `${SITE}/#source`,
  gerrymandering: `${SITE}/#gerrymandering`,
  dataset: `${SITE}/#dataset`,
} as const;
const ref = (id: string): { '@id': string } => ({ '@id': id });

/** Release dates, read from the changelogs the release script writes: the first and latest dated release overall and for the maps. */
export interface Release {
  published: string;
  modified: string;
  mapsPublished: string;
  mapsModified: string;
  mapsVersion: string;
}

let release: Release | null = null;

function datesIn(file: string): string[] {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    throw new Error(`structured data: cannot read ${file}`);
  }
  return [...text.matchAll(/^## .*\((\d{4}-\d{2}-\d{2})\)\s*$/gm)].map((m) => m[1]!);
}

/** Reads the changelogs and `config/versions.json` from the working directory; an unreadable or undated file fails the build. */
export function readRelease(): Release {
  if (release !== null) return release;
  const files = readdirSync('changelog').filter((f) => f.endsWith('.md'));
  const all = files.flatMap((f) => datesIn(join('changelog', f))).sort();
  const maps = datesIn(join('changelog', 'maps.md')).sort();
  if (all.length === 0 || maps.length === 0) throw new Error('structured data: the changelogs hold no dated release');
  let versions: { maps?: unknown };
  try {
    versions = JSON.parse(readFileSync(join('config', 'versions.json'), 'utf8')) as { maps?: unknown };
  } catch {
    throw new Error('structured data: cannot read config/versions.json');
  }
  if (typeof versions.maps !== 'number') throw new Error('structured data: config/versions.json has no maps version');
  release = { published: all[0]!, modified: all[all.length - 1]!, mapsPublished: maps[0]!, mapsModified: maps[maps.length - 1]!, mapsVersion: String(versions.maps) };
  return release;
}

/** The author (also the publisher) and website every page's graph carries, so each page can point at them by `@id`. */
export function siteNodes(): Node[] {
  return [
    {
      '@type': 'Person',
      '@id': ID.author,
      name: 'Chris Melson',
      alternateName: 'Christopher Melson',
      url: 'https://chris.melson.us',
      description: 'Operational Architect for the Agentic Age',
      jobTitle: 'Transformation Executive & Operational Architect',
      // Profiles confirmed on the author's own site. Add others here only once they are verified.
      sameAs: ['https://chris.melson.us', 'https://www.linkedin.com/in/chris-melson/', 'https://github.com/mels0n'],
      homeLocation: { '@type': 'Place', name: 'Saint Louis, MO', address: { '@type': 'PostalAddress', addressLocality: 'Saint Louis', addressRegion: 'MO', addressCountry: 'US' } },
      alumniOf: [
        { '@type': 'CollegeOrUniversity', name: 'Webster University' },
        { '@type': 'CollegeOrUniversity', name: 'Ranken Technical College' },
      ],
      knowsAbout: [
        'Target Operating Model design',
        'Organizational transformation and change management',
        'Post-merger integration',
        'AI strategy and agentic workflow governance',
        'Technical due diligence',
        'Data strategy',
        'Digital transformation and cloud migration',
        'Enterprise risk management',
        'Regulatory compliance and governance',
        'Operational excellence',
        'Cybersecurity strategy',
        'Strategic performance management',
        'Redistricting and gerrymandering reform',
      ],
    },
    {
      '@type': 'WebSite',
      '@id': ID.website,
      name: 'Fair Maps',
      url: `${SITE}/`,
      description: PAGE_META.home.description,
      inLanguage: 'en-US',
      publisher: ref(ID.author),
      creator: ref(ID.author),
    },
  ];
}

/** The Census Bureau data the maps are drawn from. */
export function censusNode(): Node {
  return { '@type': 'Dataset', '@id': ID.census, name: 'Census Bureau 2020 Census redistricting data', url: CENSUS_URL, publisher: { '@type': 'Organization', name: 'U.S. Census Bureau' } };
}

/** The open-source generator that draws the maps. */
export function sourceNode(): Node {
  return {
    '@type': 'SoftwareSourceCode',
    '@id': ID.source,
    name: 'str-redistricting',
    description: 'The open-source shortest splitline district generator behind the Fair Maps district plans.',
    codeRepository: REPO,
    url: REPO,
    programmingLanguage: 'TypeScript',
    license: 'https://www.apache.org/licenses/LICENSE-2.0',
    author: ref(ID.author),
  };
}

function gerrymanderingNode(): Node {
  return { '@type': 'Thing', '@id': ID.gerrymandering, name: 'Gerrymandering', sameAs: 'https://en.wikipedia.org/wiki/Gerrymandering' };
}

/** A `BreadcrumbList` node; every item is an absolute URL. */
export function breadcrumbNode(id: string, items: readonly { name: string; url: string }[]): Node {
  return {
    '@type': 'BreadcrumbList',
    '@id': id,
    itemListElement: items.map((item, i) => ({ '@type': 'ListItem', position: i + 1, name: item.name, item: item.url })),
  };
}

const graph = (nodes: Node[]): Graph => ({ '@context': 'https://schema.org', '@graph': nodes });

const HOME_URL = `${SITE}/`;
const PAGE_NAMES: Record<PageKey, string> = { home: 'Fair Maps', how: 'How it works', faq: 'FAQ', changelog: 'Changelog' };
const pageUrl = (key: PageKey): string => (key === 'home' ? HOME_URL : `${SITE}${PAGE_META[key].path}`);

/** The crumbs of a fixed page: Home, then the page itself unless it is Home. */
function pageCrumbs(key: PageKey): { name: string; url: string }[] {
  return key === 'home' ? [{ name: 'Home', url: HOME_URL }] : [{ name: 'Home', url: HOME_URL }, { name: PAGE_NAMES[key], url: pageUrl(key) }];
}

/** The fields every fixed page's `WebPage` shares. */
function webPage(key: PageKey, types: string | string[], extra: Node): Node {
  const url = pageUrl(key);
  const { published, modified } = readRelease();
  return {
    '@type': types,
    '@id': `${url}#webpage`,
    url,
    name: PAGE_META[key].title,
    description: PAGE_META[key].description,
    inLanguage: 'en-US',
    isPartOf: ref(ID.website),
    publisher: ref(ID.author),
    breadcrumb: ref(`${url}#breadcrumb`),
    datePublished: published,
    dateModified: modified,
    ...extra,
  };
}

function homeNodes(): Node[] {
  const r = readRelease();
  const url = pageUrl('home');
  return [
    ...siteNodes(),
    censusNode(),
    sourceNode(),
    gerrymanderingNode(),
    webPage('home', ['WebPage', 'CollectionPage'], { about: [ref(ID.dataset), ref(ID.gerrymandering)], primaryImageOfPage: OG_IMAGE }),
    breadcrumbNode(`${url}#breadcrumb`, pageCrumbs('home')),
    {
      '@type': 'Dataset',
      '@id': ID.dataset,
      name: 'Fair Maps district plans',
      description: PAGE_META.home.description,
      url,
      keywords: ['gerrymandering', 'redistricting', 'shortest splitline', 'congressional districts', 'state legislative districts', 'census blocks'],
      license: 'https://creativecommons.org/licenses/by/4.0/',
      creator: ref(ID.author),
      publisher: ref(ID.author),
      copyrightHolder: ref(ID.author),
      creditText: `Chris Melson, ${SITE_HOST}`,
      isAccessibleForFree: true,
      inLanguage: 'en-US',
      isBasedOn: [ref(ID.census), ref(ID.source)],
      measurementTechnique: 'Shortest splitline algorithm',
      spatialCoverage: 'United States',
      temporalCoverage: '2020',
      version: r.mapsVersion,
      datePublished: r.mapsPublished,
      dateModified: r.mapsModified,
      isPartOf: ref(ID.website),
      distribution: [{ '@type': 'DataDownload', contentUrl: `${SITE}/data/index.json`, encodingFormat: 'application/json' }],
    },
  ];
}

function howNodes(): Node[] {
  const url = pageUrl('how');
  const { published, modified } = readRelease();
  return [
    ...siteNodes(),
    gerrymanderingNode(),
    webPage('how', 'WebPage', { mainEntity: ref(`${url}#article`) }),
    breadcrumbNode(`${url}#breadcrumb`, pageCrumbs('how')),
    {
      '@type': 'TechArticle',
      '@id': `${url}#article`,
      headline: 'How the districts are drawn',
      description: PAGE_META.how.description,
      url,
      mainEntityOfPage: ref(`${url}#webpage`),
      isPartOf: ref(`${url}#webpage`),
      author: ref(ID.author),
      publisher: ref(ID.author),
      datePublished: published,
      dateModified: modified,
      inLanguage: 'en-US',
      articleSection: 'Method',
      about: ref(ID.gerrymandering),
      image: OG_IMAGE,
      breadcrumb: ref(`${url}#breadcrumb`),
    },
  ];
}

function faqNodes(faq: readonly FaqEntry[], questionSlugs: readonly string[]): Node[] {
  const url = pageUrl('faq');
  // The page lists its answers in question order, so the slug of each is its position; any other length is not mapped.
  const slugs = faq.length === questionSlugs.length ? questionSlugs : null;
  const { published, modified } = readRelease();
  return [
    ...siteNodes(),
    gerrymanderingNode(),
    webPage('faq', 'WebPage', { about: ref(ID.gerrymandering), mainEntity: ref(`${url}#faq`) }),
    {
      '@type': 'FAQPage',
      '@id': `${url}#faq`,
      url,
      name: PAGE_META.faq.title,
      description: PAGE_META.faq.description,
      inLanguage: 'en-US',
      isPartOf: ref(ID.website),
      author: ref(ID.author),
      publisher: ref(ID.author),
      datePublished: published,
      dateModified: modified,
      about: ref(ID.gerrymandering),
      breadcrumb: ref(`${url}#breadcrumb`),
      mainEntityOfPage: ref(`${url}#webpage`),
      mainEntity: faq.map((f, i) => ({
        '@type': 'Question',
        name: f.q,
        ...(slugs === null ? {} : { url: `${url}/${slugs[i]}` }),
        acceptedAnswer: { '@type': 'Answer', text: f.a, author: ref(ID.author), datePublished: published, dateModified: modified },
      })),
    },
    breadcrumbNode(`${url}#breadcrumb`, pageCrumbs('faq')),
  ];
}

function changelogNodes(): Node[] {
  const url = pageUrl('changelog');
  return [
    ...siteNodes(),
    webPage('changelog', ['WebPage', 'CollectionPage'], { about: ref(ID.source) }),
    sourceNode(),
    breadcrumbNode(`${url}#breadcrumb`, pageCrumbs('changelog')),
  ];
}

/** The structured data each prerendered page carries, as one `@graph`; the FAQ entries feed the FAQ page's `FAQPage`. */
export function jsonLd(key: PageKey, faq: readonly FaqEntry[], questionSlugs: readonly string[]): Graph[] {
  switch (key) {
    case 'home':
      return [graph(homeNodes())];
    case 'how':
      return [graph(howNodes())];
    case 'faq':
      return [graph(faqNodes(faq, questionSlugs))];
    case 'changelog':
      return [graph(changelogNodes())];
  }
}

/** A state or chamber share page's graph: the page, its breadcrumb, the state and the plan's dataset. */
export function sharePageGraph(p: {
  url: string;
  title: string;
  description: string;
  state: string;
  /** The chamber's label, such as "State Senate"; absent for the federal House. */
  chamber: string | undefined;
  stateUrl: string;
  /** Published data files of this plan that exist, as absolute URLs with their media type. */
  files: readonly { url: string; encodingFormat: string; name: string }[];
}): Graph {
  const r = readRelease();
  const kind = p.chamber ?? 'congressional';
  const crumbs = [{ name: 'Home', url: HOME_URL }, { name: p.state, url: p.stateUrl }, ...(p.chamber === undefined ? [] : [{ name: p.chamber, url: p.url }])];
  const place = `${p.stateUrl}#place`;
  const datasetId = `${p.url}#dataset`;
  const nodes: Node[] = [
    ...siteNodes(),
    censusNode(),
    {
      '@type': 'WebPage',
      '@id': `${p.url}#webpage`,
      url: p.url,
      name: p.title,
      description: p.description,
      inLanguage: 'en-US',
      isPartOf: ref(ID.website),
      publisher: ref(ID.author),
      breadcrumb: ref(`${p.url}#breadcrumb`),
      about: [ref(place), ref(datasetId)],
    },
    breadcrumbNode(`${p.url}#breadcrumb`, crumbs),
    { '@type': 'State', '@id': place, name: p.state, containedInPlace: { '@type': 'Country', name: 'United States' } },
    {
      '@type': 'Dataset',
      '@id': datasetId,
      name: `${p.state} ${kind} districts drawn by Fair Maps`,
      description: p.description,
      url: p.url,
      license: 'https://creativecommons.org/licenses/by/4.0/',
      creator: ref(ID.author),
      publisher: ref(ID.author),
      copyrightHolder: ref(ID.author),
      creditText: `Chris Melson, ${SITE_HOST}`,
      isAccessibleForFree: true,
      inLanguage: 'en-US',
      isBasedOn: ref(ID.census),
      measurementTechnique: 'Shortest splitline algorithm',
      spatialCoverage: ref(place),
      temporalCoverage: '2020',
      version: r.mapsVersion,
      isPartOf: ref(ID.website),
      ...(p.files.length === 0 ? {} : { distribution: p.files.map((f) => ({ '@type': 'DataDownload', name: f.name, contentUrl: f.url, encodingFormat: f.encodingFormat })) }),
    },
  ];
  return graph(nodes);
}

/** The JSON-LD script tag for a page, or an empty string when it has none. `<` is escaped so no value can close the tag. */
export function jsonLdScript(objects: readonly object[]): string {
  if (objects.length === 0) return '';
  const json = JSON.stringify(objects.length === 1 ? objects[0] : objects).replace(/</g, String.fromCharCode(92) + 'u003c');
  return `<script type="application/ld+json">${json}</script>`;
}
