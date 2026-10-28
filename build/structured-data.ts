import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PAGE_META } from '../src/client/shared/lib/page-meta.js';
// Imported from the file, not the publish slice's index, so the Vite config does not load the image renderer.
import { SITE_HOST } from '../src/server/features/publish/site.js';

/** The project's public source repository (the client config repeats it and tests/client/site-host.test.ts keeps the two equal). */
export const REPO_URL = 'https://github.com/mels0n/str-redistricting';

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
const CENSUS_URL = 'https://www.census.gov/programs-surveys/decennial-census/about/rdo.html';
const OG_IMAGE = { '@type': 'ImageObject', url: `${SITE}/og-image.png`, width: 1200, height: 630 };

/** The author's facts, copied from his own site (chris.melson.us) on 2026-10-24. Add a fact here only once it is published there. */
const AUTHOR = {
  name: 'Chris Melson',
  alternateName: 'Christopher Melson',
  url: 'https://chris.melson.us',
  description: 'Operational Architect for the Agentic Age',
  jobTitle: 'Transformation Executive & Operational Architect',
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
} as const;

/** The terms the published data and the code are offered under, and how the data is credited. */
export const DATA_LICENSE_URL = 'https://creativecommons.org/licenses/by/4.0/';
export const DATA_LICENSE_NAME = 'CC BY 4.0';
export const CODE_LICENSE_URL = 'https://www.apache.org/licenses/LICENSE-2.0';
export const CODE_LICENSE_NAME = 'Apache-2.0';
export const CREDIT_TEXT = `${AUTHOR.name}, ${SITE_HOST}`;
export const METHOD = 'Shortest splitline algorithm';

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

interface Dated {
  label: string;
  date: string;
}
interface Span {
  published: string;
  modified: string;
}

/** Release dates, read from the changelogs the release script writes. */
export interface Release {
  /** First and latest dated release of any component (the changelog page). */
  all: Span;
  /** The website's own releases (home, FAQ). */
  web: Span;
  /** The website and the engine, which defines the method the How page explains. */
  how: Span;
  /** Every dated maps release, oldest first. */
  maps: Dated[];
}

const releases = new Map<string, Release>();

/** Forgets what `readRelease` read; for tests that change the files. */
export function resetRelease(): void {
  releases.clear();
}

function read(file: string): string {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    throw new Error(`structured data: cannot read ${file}`);
  }
}

function headings(file: string): Dated[] {
  const found = [...read(file).matchAll(/^## (.*?) ?\((\d{4}-\d{2}-\d{2})\)\s*$/gm)].map((m) => ({ label: m[1]!, date: m[2]! }));
  if (found.length === 0) throw new Error(`structured data: ${file} holds no dated release`);
  return found.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

const span = (items: readonly Dated[]): Span => ({ published: items[0]!.date, modified: items[items.length - 1]!.date });

/** Reads the changelogs under `root` (default: the working directory); an unreadable or undated file fails the build. */
export function readRelease(root = '.'): Release {
  const cached = releases.get(root);
  if (cached !== undefined) return cached;
  const dir = join(root, 'changelog');
  let names: string[];
  try {
    names = readdirSync(dir).filter((f) => f.endsWith('.md'));
  } catch {
    throw new Error(`structured data: cannot read ${dir}`);
  }
  const byFile = (f: string): Dated[] => headings(join(dir, f));
  const web = byFile('web.md');
  const engine = byFile('engine.md');
  const all = names.flatMap(byFile).sort((a, b) => (a.date < b.date ? -1 : 1));
  const built: Release = { all: span(all), web: span(web), how: span([...web, ...engine].sort((a, b) => (a.date < b.date ? -1 : 1))), maps: byFile('maps.md') };
  releases.set(root, built);
  return built;
}

/** The maps release the published data carries (`public/data/versions.json`, which publish keeps honest), or null when it is absent or unreadable. */
export function publishedMapsVersion(root = '.'): number | null {
  try {
    const v = (JSON.parse(readFileSync(join(root, 'public', 'data', 'versions.json'), 'utf8')) as { maps?: unknown }).maps;
    return typeof v === 'number' ? v : null;
  } catch {
    return null;
  }
}

/** The `version` and `dateModified` of a maps release, or nothing when none is stamped; the date is that release's changelog heading. */
function mapsStamp(version: number | null | undefined): Node {
  if (version === null || version === undefined) return {};
  const heading = readRelease().maps.find((m) => m.label === String(version));
  return { version: String(version), ...(heading === undefined ? {} : { dateModified: heading.date }) };
}

/** The author (also the publisher) and website every page's graph carries, so each page can point at them by `@id`. */
export function siteNodes(): Node[] {
  return [
    { '@type': 'Person', '@id': ID.author, ...AUTHOR },
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
  return {
    '@type': 'Dataset',
    '@id': ID.census,
    name: 'Census Bureau 2020 Census redistricting data',
    description: 'The 2020 Census population counts and block shapes the Census Bureau publishes for redistricting.',
    url: CENSUS_URL,
    publisher: { '@type': 'Organization', name: 'U.S. Census Bureau' },
  };
}

/** The open-source generator that draws the maps. */
export function sourceNode(): Node {
  return {
    '@type': 'SoftwareSourceCode',
    '@id': ID.source,
    name: 'str-redistricting',
    description: 'The open-source shortest splitline district generator behind the Fair Maps district plans.',
    codeRepository: REPO_URL,
    url: REPO_URL,
    programmingLanguage: 'TypeScript',
    license: CODE_LICENSE_URL,
    author: ref(ID.author),
  };
}

/** The fields every Fair Maps dataset shares; `extra` adds or overrides. */
function datasetBase(extra: Node): Node {
  return {
    '@type': 'Dataset',
    license: DATA_LICENSE_URL,
    creator: ref(ID.author),
    publisher: ref(ID.author),
    copyrightHolder: ref(ID.author),
    creditText: CREDIT_TEXT,
    isAccessibleForFree: true,
    inLanguage: 'en-US',
    measurementTechnique: METHOD,
    temporalCoverage: '2020',
    isPartOf: ref(ID.website),
    ...extra,
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
const PAGE_NAMES: Record<PageKey, string> = { home: 'Fair Maps', act: 'Take action', how: 'How it works', faq: 'FAQ', changelog: 'Changelog', pledges: 'Sites that show the badge', privacy: 'Privacy', remove: 'Remove your signature', confirm: 'Confirm your signature' };
const pageUrl = (key: PageKey): string => (key === 'home' ? HOME_URL : `${SITE}${PAGE_META[key].path}`);

/** The crumbs of a page below Home. The home page has none: a trail of one item is not worth marking up. */
function pageCrumbs(key: Exclude<PageKey, 'home'>): { name: string; url: string }[] {
  return [{ name: 'Home', url: HOME_URL }, { name: PAGE_NAMES[key], url: pageUrl(key) }];
}

/** The dates a fixed page reports: its own source's releases (the changelog page covers every component). */
function datesOf(key: PageKey, r: Release): Span {
  return key === 'changelog' ? r.all : key === 'how' ? r.how : r.web;
}

/** The fields every fixed page's `WebPage` shares. */
function webPage(key: PageKey, types: string | string[], extra: Node): Node {
  const url = pageUrl(key);
  const { published, modified } = datesOf(key, readRelease());
  return {
    '@type': types,
    '@id': `${url}#webpage`,
    url,
    name: PAGE_META[key].title,
    description: PAGE_META[key].description,
    inLanguage: 'en-US',
    isPartOf: ref(ID.website),
    publisher: ref(ID.author),
    ...(key === 'home' ? {} : { breadcrumb: ref(`${url}#breadcrumb`) }),
    datePublished: published,
    dateModified: modified,
    ...extra,
  };
}

function homeNodes(): Node[] {
  const url = pageUrl('home');
  const maps = readRelease().maps;
  return [
    ...siteNodes(),
    censusNode(),
    sourceNode(),
    gerrymanderingNode(),
    webPage('home', ['WebPage', 'CollectionPage'], { about: [ref(ID.dataset), ref(ID.gerrymandering)], primaryImageOfPage: OG_IMAGE }),
    datasetBase({
      '@id': ID.dataset,
      name: 'Fair Maps district plans',
      description: PAGE_META.home.description,
      url,
      keywords: ['gerrymandering', 'redistricting', 'shortest splitline', 'congressional districts', 'state legislative districts', 'census blocks'],
      isBasedOn: [ref(ID.census), ref(ID.source)],
      spatialCoverage: 'United States',
      datePublished: maps[0]!.date,
      ...mapsStamp(publishedMapsVersion()),
      distribution: [{ '@type': 'DataDownload', contentUrl: `${SITE}/data/index.json`, encodingFormat: 'application/json' }],
    }),
  ];
}

function howNodes(): Node[] {
  const url = pageUrl('how');
  const { published, modified } = datesOf('how', readRelease());
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

function faqNodes(faq: readonly FaqEntry[]): Node[] {
  const url = pageUrl('faq');
  const { published, modified } = datesOf('faq', readRelease());
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
      mainEntity: faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a, author: ref(ID.author) } })),
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

function pledgesNodes(): Node[] {
  const url = pageUrl('pledges');
  return [...siteNodes(), webPage('pledges', 'WebPage', {}), breadcrumbNode(`${url}#breadcrumb`, pageCrumbs('pledges'))];
}

function actNodes(): Node[] {
  const url = pageUrl('act');
  return [...siteNodes(), webPage('act', 'WebPage', {}), breadcrumbNode(`${url}#breadcrumb`, pageCrumbs('act'))];
}

function privacyNodes(): Node[] {
  const url = pageUrl('privacy');
  return [...siteNodes(), webPage('privacy', 'WebPage', {}), breadcrumbNode(`${url}#breadcrumb`, pageCrumbs('privacy'))];
}

function removeNodes(): Node[] {
  const url = pageUrl('remove');
  return [...siteNodes(), webPage('remove', 'WebPage', {}), breadcrumbNode(`${url}#breadcrumb`, pageCrumbs('remove'))];
}

function confirmNodes(): Node[] {
  const url = pageUrl('confirm');
  return [...siteNodes(), webPage('confirm', 'WebPage', {}), breadcrumbNode(`${url}#breadcrumb`, pageCrumbs('confirm'))];
}

/** The structured data each prerendered page carries, as one `@graph`; the FAQ entries feed the FAQ page's `FAQPage`. */
export function jsonLd(key: PageKey, faq: readonly FaqEntry[]): Graph[] {
  switch (key) {
    case 'home':
      return [graph(homeNodes())];
    case 'how':
      return [graph(howNodes())];
    case 'faq':
      return [graph(faqNodes(faq))];
    case 'changelog':
      return [graph(changelogNodes())];
    case 'pledges':
      return [graph(pledgesNodes())];
    case 'act':
      return [graph(actNodes())];
    case 'privacy':
      return [graph(privacyNodes())];
    case 'remove':
      return [graph(removeNodes())];
    case 'confirm':
      return [graph(confirmNodes())];
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
  /** The maps release this plan is stamped with in the published index; absent when it has no stamp. */
  mapsVersion: number | undefined;
  /** Published data files of this plan that exist, as absolute URLs with their media type. */
  files: readonly { url: string; encodingFormat: string; name: string }[];
}): Graph {
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
    datasetBase({
      '@id': datasetId,
      name: `${p.state} ${kind} districts drawn by Fair Maps`,
      description: p.description,
      url: p.url,
      isBasedOn: ref(ID.census),
      spatialCoverage: ref(place),
      ...mapsStamp(p.mapsVersion),
      ...(p.files.length === 0 ? {} : { distribution: p.files.map((f) => ({ '@type': 'DataDownload', name: f.name, contentUrl: f.url, encodingFormat: f.encodingFormat })) }),
    }),
  ];
  return graph(nodes);
}

/** The JSON-LD script tag for a page, or an empty string when it has none. `<` is escaped so no value can close the tag. */
export function jsonLdScript(objects: readonly object[]): string {
  if (objects.length === 0) return '';
  const json = JSON.stringify(objects.length === 1 ? objects[0] : objects).replace(/</g, String.fromCharCode(92) + 'u003c');
  return `<script type="application/ld+json">${json}</script>`;
}
