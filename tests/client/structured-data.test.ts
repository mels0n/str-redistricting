// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sharePageHtml } from '../../build/share-pages';
import { PAGE_KEYS, jsonLd, jsonLdScript } from '../../build/seo';
import { readRelease } from '../../build/structured-data';
import { FAQ_QUESTIONS } from '../../src/client/shared';
import { SHELL } from '../helpers/shell';

const SITE = 'https://fairmaps.melson.us';
const EM_DASH = String.fromCharCode(0x2014);
const EXTERNAL = new Set([
  'https://schema.org',
  'https://chris.melson.us',
  'https://www.linkedin.com/in/chris-melson/',
  'https://github.com/mels0n',
  'https://github.com/mels0n/str-redistricting',
  'https://en.wikipedia.org/wiki/Gerrymandering',
  'https://creativecommons.org/licenses/by/4.0/',
  'https://www.apache.org/licenses/LICENSE-2.0',
  'https://www.census.gov/programs-surveys/decennial-census/about/rdo.html',
]);
const faq = FAQ_QUESTIONS.map((q) => ({ q: `Question ${q}?`, a: `Answer ${q}.` }));

type Graph = { '@context': string; '@graph': Record<string, unknown>[] };
const scriptOf = (html: string): Graph[] => [...html.matchAll(/<script type="application\/ld\+json">([^<]*)<\/script>/g)].map((m) => JSON.parse(m[1]!) as Graph);

function walk(value: unknown, visit: (v: unknown, key: string | null) => void, key: string | null = null): void {
  visit(value, key);
  if (Array.isArray(value)) for (const v of value) walk(v, visit, key);
  else if (value !== null && typeof value === 'object') for (const [k, v] of Object.entries(value)) walk(v, visit, k);
}

function check(g: Graph): void {
  expect(g['@context']).toBe('https://schema.org');
  const ids = new Set(g['@graph'].map((n) => n['@id']).filter((i): i is string => typeof i === 'string'));
  expect(ids.size).toBe(g['@graph'].filter((n) => n['@id'] !== undefined).length);
  walk(g['@graph'], (v, key) => {
    if (v === undefined || v === '') throw new Error(`empty value under ${key}`);
    if (typeof v === 'string') {
      expect(v).not.toContain(EM_DASH);
      expect(v).not.toBe('undefined');
      if (/^https?:\/\//.test(v)) expect(v.startsWith(`${SITE}/`) || v === SITE || EXTERNAL.has(v), `url ${v}`).toBe(true);
    }
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      const o = v as Record<string, unknown>;
      const keys = Object.keys(o);
      if (keys.length === 1 && keys[0] === '@id') expect(ids.has(o['@id'] as string), `unresolved ${String(o['@id'])}`).toBe(true);
    }
  });
}

const types = (g: Graph): string[] => g['@graph'].flatMap((n) => [n['@type']].flat() as string[]);

describe('page graphs', () => {
  for (const key of PAGE_KEYS) {
    it(`${key}: one valid @graph whose references resolve`, () => {
      const out = jsonLd(key, faq);
      expect(out).toHaveLength(1);
      check(out[0] as unknown as Graph);
      const t = types(out[0] as unknown as Graph);
      expect(t).toContain('BreadcrumbList');
      expect(t).toContain('Person');
      expect(t).toContain('WebSite');
    });
  }

  it('describes the home page with a dataset built on the Census data', () => {
    const g = jsonLd('home', faq)[0] as unknown as Graph;
    const t = types(g);
    for (const x of ['CollectionPage', 'Dataset', 'SoftwareSourceCode']) expect(t).toContain(x);
    const ds = g['@graph'].find((n) => n['@id'] === `${SITE}/#dataset`)!;
    expect(ds.measurementTechnique).toBe('Shortest splitline algorithm');
    expect(ds.version).toMatch(/^\d+$/);
  });

  it('takes release dates from the changelogs', () => {
    const r = readRelease();
    expect(r.published <= r.modified).toBe(true);
    expect(r.published).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('keeps the FAQ guarantee and links each question to its slug', () => {
    const g = jsonLd('faq', faq)[0] as unknown as Graph;
    const page = g['@graph'].find((n) => n['@type'] === 'FAQPage')!;
    const qs = page.mainEntity as { url: string }[];
    expect(qs).toHaveLength(15);
    expect(qs[0]!.url).toBe(`${SITE}/faq/gerrymandering`);
  });

  it('adds no question urls when the entries do not line up with the questions', () => {
    const g = jsonLd('faq', faq.slice(1))[0] as unknown as Graph;
    const page = g['@graph'].find((n) => n['@type'] === 'FAQPage')!;
    expect((page.mainEntity as Record<string, unknown>[])[0]).not.toHaveProperty('url');
  });
});

describe('share page graphs', () => {
  const build = (name: string, chamber?: 'state-house' | 'state-senate', files: string[] = ['districts.topo.json', 'stats.json']): Graph[] =>
    scriptOf(sharePageHtml({ abbr: 'CO', name, seats: 8, ...(chamber === undefined ? {} : { chamber }) }, SITE, SHELL, true, files));

  it('writes a state page with place, dataset and breadcrumb', () => {
    const scripts = build('Colorado');
    expect(scripts).toHaveLength(1);
    check(scripts[0]!);
    const t = types(scripts[0]!);
    for (const x of ['WebPage', 'BreadcrumbList', 'State', 'Dataset']) expect(t).toContain(x);
    const ds = scripts[0]!['@graph'].find((n) => n['@id'] === `${SITE}/CO#dataset`)!;
    expect((ds.distribution as { contentUrl: string }[]).map((d) => d.contentUrl)).toEqual([`${SITE}/data/CO/districts.topo.json`, `${SITE}/data/CO/stats.json`]);
  });

  it('adds the chamber to the crumbs and data path, and omits files that do not exist', () => {
    const g = build('Colorado', 'state-senate', [])[0]!;
    check(g);
    const crumbs = g['@graph'].find((n) => n['@type'] === 'BreadcrumbList')!.itemListElement as { item: string }[];
    expect(crumbs.map((c) => c.item)).toEqual([`${SITE}/`, `${SITE}/CO`, `${SITE}/CO/senate`]);
    expect(g['@graph'].find((n) => n['@id'] === `${SITE}/CO/senate#dataset`)).not.toHaveProperty('distribution');
  });

  it('escapes a hostile name', () => {
    const html = sharePageHtml({ abbr: 'CO', name: '</script><b>$&', seats: 1 }, SITE, SHELL, true, []);
    const body = /<script type="application\/ld\+json">([^]*?)<\/script>/.exec(html)![1]!;
    expect(body).not.toContain('<');
    const g = JSON.parse(body) as Graph;
    expect(g['@graph'].find((n) => n['@type'] === 'State')!.name).toBe('</script><b>$&');
    expect(html.match(/application\/ld\+json/g)).toHaveLength(1);
  });
});

describe('built files', () => {
  it('parses and resolves every built page when dist exists', () => {
    if (!existsSync('dist/index.html')) return;
    for (const f of ['dist/index.html', 'dist/how/index.html', 'dist/faq/index.html', 'dist/changelog/index.html']) {
      const scripts = scriptOf(readFileSync(f, 'utf8'));
      expect(scripts).toHaveLength(1);
      check(scripts[0]!);
    }
  });
  it('escapes through the shared script builder', () => {
    expect(jsonLdScript([{ a: '<' }])).not.toMatch(/<[^s/]/);
  });
});
