// @vitest-environment node
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sharePageHtml } from '../../build/share-pages';
import { PAGE_KEYS, jsonLd, jsonLdScript } from '../../build/seo';
import { readRelease, resetRelease } from '../../build/structured-data';
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
const node = (g: Graph, id: string): Record<string, unknown> => g['@graph'].find((n) => n['@id'] === id)!;
const crumbsOf = (g: Graph): string[] => (g['@graph'].find((n) => n['@type'] === 'BreadcrumbList')!.itemListElement as { item: string }[]).map((c) => c.item);

/** The first and last heading dates of changelogs, read straight from the files. */
function bounds(...files: string[]): [string, string] {
  const dates = files.flatMap((f) => [...readFileSync(join('changelog', f), 'utf8').matchAll(/^## .*\((\d{4}-\d{2}-\d{2})\)$/gm)].map((m) => m[1]!)).sort();
  return [dates[0]!, dates[dates.length - 1]!];
}
const mapsDate = (version: number): string => new RegExp(`^## ${version} \\((\\d{4}-\\d{2}-\\d{2})\\)$`, 'm').exec(readFileSync('changelog/maps.md', 'utf8'))![1]!;

describe('page graphs', () => {
  for (const key of PAGE_KEYS) {
    it(`${key}: one valid @graph whose references resolve`, () => {
      const out = jsonLd(key, faq);
      expect(out).toHaveLength(1);
      check(out[0] as unknown as Graph);
      const t = types(out[0] as unknown as Graph);
      expect(t).toContain('Person');
      expect(t).toContain('WebSite');
      // A trail of one item is not marked up, so the home page has none.
      expect(t.includes('BreadcrumbList')).toBe(key !== 'home');
    });
  }

  it('describes the home page with a dataset built on the Census data', () => {
    const g = jsonLd('home', faq)[0] as unknown as Graph;
    const t = types(g);
    for (const x of ['CollectionPage', 'Dataset', 'SoftwareSourceCode']) expect(t).toContain(x);
    expect(node(g, `${SITE}/#webpage`)).not.toHaveProperty('breadcrumb');
    expect(node(g, `${SITE}/#dataset`).measurementTechnique).toBe('Shortest splitline algorithm');
    const census = node(g, `${SITE}/#census-data`);
    expect((census.description as string).length).toBeGreaterThanOrEqual(50);
    expect(census).not.toHaveProperty('license');
  });

  it('types the other pages', () => {
    expect(types(jsonLd('how', faq)[0] as unknown as Graph)).toContain('TechArticle');
    const t = types(jsonLd('changelog', faq)[0] as unknown as Graph);
    expect(t).toContain('CollectionPage');
    expect(t).toContain('SoftwareSourceCode');
  });

  it('dates each page from its own changelogs', () => {
    const [webFirst, webLast] = bounds('web.md');
    const [howFirst, howLast] = bounds('web.md', 'engine.md');
    const [allFirst, allLast] = bounds(...readdirSync('changelog').filter((f) => f.endsWith('.md')));
    expect(node(jsonLd('home', faq)[0] as unknown as Graph, `${SITE}/#webpage`)).toMatchObject({ datePublished: webFirst, dateModified: webLast });
    expect(node(jsonLd('how', faq)[0] as unknown as Graph, `${SITE}/how#article`)).toMatchObject({ datePublished: howFirst, dateModified: howLast });
    expect(node(jsonLd('faq', faq)[0] as unknown as Graph, `${SITE}/faq#faq`)).toMatchObject({ datePublished: webFirst, dateModified: webLast });
    expect(node(jsonLd('changelog', faq)[0] as unknown as Graph, `${SITE}/changelog#webpage`)).toMatchObject({ datePublished: allFirst, dateModified: allLast });
  });

  it('stamps the home dataset from the published data, not the declared release', () => {
    const published = JSON.parse(readFileSync('public/data/versions.json', 'utf8')) as { maps: number };
    const ds = node(jsonLd('home', faq)[0] as unknown as Graph, `${SITE}/#dataset`);
    expect(ds.version).toBe(String(published.maps));
    expect(ds.dateModified).toBe(mapsDate(published.maps));
    expect(ds.datePublished).toBe(bounds('maps.md')[0]);
  });

  it('keeps the FAQ guarantee and gives questions no urls or dates of their own', () => {
    const page = node(jsonLd('faq', faq)[0] as unknown as Graph, `${SITE}/faq#faq`);
    const qs = page.mainEntity as Record<string, unknown>[];
    expect(qs).toHaveLength(FAQ_QUESTIONS.length);
    expect(qs[0]).not.toHaveProperty('url');
    expect(qs[0]!.acceptedAnswer).not.toHaveProperty('datePublished');
    expect(qs[0]!.acceptedAnswer).not.toHaveProperty('dateModified');
  });
});

describe('readRelease', () => {
  const write = (root: string, name: string, text: string): void => {
    mkdirSync(join(root, 'changelog'), { recursive: true });
    writeFileSync(join(root, 'changelog', name), text);
  };
  const fixture = (): string => {
    const root = mkdtempSync(join(tmpdir(), 'rel-'));
    write(root, 'web.md', '# Web\n\n## 1.0.0 (2026-01-02)\n\n- a\n\n## 1.1.0 (2026-03-05)\n\n- b\n');
    write(root, 'engine.md', '# Engine\n\n## 2.0.0 (2026-06-30)\n\n- c\n\n## 1.0.0 (2025-12-01)\n');
    write(root, 'maps.md', '# Maps\n\n## 2 (2026-04-04)\n\n## 1 (2026-02-02)\n');
    return root;
  };

  it('finds bounds whatever the order of the headings and files', () => {
    resetRelease();
    const r = readRelease(fixture());
    expect(r.all).toEqual({ published: '2025-12-01', modified: '2026-06-30' });
    expect(r.web).toEqual({ published: '2026-01-02', modified: '2026-03-05' });
    expect(r.how).toEqual({ published: '2025-12-01', modified: '2026-06-30' });
    expect(r.maps).toEqual([{ label: '1', date: '2026-02-02' }, { label: '2', date: '2026-04-04' }]);
  });

  it('fails clearly on an undated, missing or absent changelog', () => {
    resetRelease();
    const undated = fixture();
    writeFileSync(join(undated, 'changelog', 'maps.md'), '# Maps\n\nno releases yet\n');
    expect(() => readRelease(undated)).toThrow(/maps\.md holds no dated release/);
    const noWeb = mkdtempSync(join(tmpdir(), 'rel-'));
    write(noWeb, 'engine.md', '## 1.0.0 (2026-01-01)\n');
    expect(() => readRelease(noWeb)).toThrow(/cannot read/);
    expect(() => readRelease(join(tmpdir(), 'rel-does-not-exist'))).toThrow(/cannot read/);
    resetRelease();
  });
});

describe('share page graphs', () => {
  const build = (name: string, chamber?: 'state-house' | 'state-senate', files: string[] = ['districts.topo.json', 'stats.json'], mapsVersion?: number): Graph[] =>
    scriptOf(sharePageHtml({ abbr: 'CO', name, seats: 8, ...(chamber === undefined ? {} : { chamber }), ...(mapsVersion === undefined ? {} : { mapsVersion }) }, SITE, SHELL, true, files));

  it('writes a state page with place, dataset and breadcrumb', () => {
    const scripts = build('Colorado');
    expect(scripts).toHaveLength(1);
    check(scripts[0]!);
    const t = types(scripts[0]!);
    for (const x of ['WebPage', 'BreadcrumbList', 'State', 'Dataset']) expect(t).toContain(x);
    expect(crumbsOf(scripts[0]!)).toEqual([`${SITE}/`, `${SITE}/CO`]);
    const ds = node(scripts[0]!, `${SITE}/CO#dataset`);
    expect((ds.distribution as { contentUrl: string }[]).map((d) => d.contentUrl)).toEqual([`${SITE}/data/CO/districts.topo.json`, `${SITE}/data/CO/stats.json`]);
    expect(ds).not.toHaveProperty('version');
  });

  it("carries the plan's own maps stamp and that release's date", () => {
    const ds = node(build('Colorado', undefined, [], 2)[0]!, `${SITE}/CO#dataset`);
    expect(ds.version).toBe('2');
    expect(ds.dateModified).toBe(mapsDate(2));
  });

  it('adds the chamber to the crumbs and omits files that do not exist', () => {
    const g = build('Colorado', 'state-senate', [])[0]!;
    check(g);
    expect(crumbsOf(g)).toEqual([`${SITE}/`, `${SITE}/CO`, `${SITE}/CO/senate`]);
    expect(node(g, `${SITE}/CO/senate#dataset`)).not.toHaveProperty('distribution');
  });

  it('links only the one file a chamber has', () => {
    const ds = node(build('Colorado', 'state-house', ['stats.json'])[0]!, `${SITE}/CO/house#dataset`);
    expect((ds.distribution as { contentUrl: string }[]).map((d) => d.contentUrl)).toEqual([`${SITE}/data/CO/state-house/stats.json`]);
  });

  it('escapes a hostile name and keeps it whole in the page and dataset', () => {
    const hostile = '</script><b>$& "x"';
    const html = sharePageHtml({ abbr: 'CO', name: hostile, seats: 1 }, SITE, SHELL, true, []);
    const body = /<script type="application\/ld\+json">([^]*?)<\/script>/.exec(html)![1]!;
    expect(body).not.toContain('<');
    expect(html.match(/application\/ld\+json/g)).toHaveLength(1);
    const g = JSON.parse(body) as Graph;
    expect(node(g, `${SITE}/CO#webpage`).name).toBe(`${hostile}: districts drawn by Fair Maps`);
    expect(node(g, `${SITE}/CO#webpage`).description as string).toContain(`${hostile}'s 1 congressional district,`);
    expect(node(g, `${SITE}/CO#dataset`).name).toBe(`${hostile} congressional districts drawn by Fair Maps`);
    expect(g['@graph'].find((n) => n['@type'] === 'State')!.name).toBe(hostile);
  });
});

describe('built files', () => {
  function pages(dir: string): string[] {
    return readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) return f === 'assets' || f === 'data' ? [] : pages(p);
      return f === 'index.html' ? [p] : [];
    });
  }

  it('parses and resolves every built page', () => {
    expect(existsSync('dist/index.html'), 'run npm run build first').toBe(true);
    const withData = pages('dist').filter((f) => readFileSync(f, 'utf8').includes('application/ld+json'));
    expect(withData.length).toBeGreaterThanOrEqual(4);
    for (const f of withData) {
      const scripts = scriptOf(readFileSync(f, 'utf8'));
      expect(scripts, f).toHaveLength(1);
      check(scripts[0]!);
    }
  });

  it('escapes < in the script body exactly', () => {
    expect(jsonLdScript([{ a: '<b>' }])).toBe('<script type="application/ld+json">{"a":"\\u003cb>"}</script>');
  });
});
