// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PAGE_META } from '../../src/client/shared/lib/page-meta';

interface Rewrite {
  source: string;
  destination: string;
}
const config = JSON.parse(readFileSync('vercel.json', 'utf8')) as { trailingSlash?: boolean; rewrites: Rewrite[] };

/**
 * A small stand-in for the host's path matcher: `:name(re)`, `:name+`, `:name*` and `:name`. It is NOT Vercel's matcher
 * (that is path-to-regexp plus the platform's own rules, such as real files winning over rewrites); it only checks that
 * the rules in vercel.json say what we mean. A rewrite match for a path that also has a built file is shadowed by the file.
 */
function compile(source: string): { re: RegExp; names: string[] } {
  const names: string[] = [];
  // `/:name*` makes the slash optional too, as in path-to-regexp: /Co matches `/:st(...)/:rest*`.
  const pattern = source.replace(/(\/?):(\w+)(\([^)]*\))?([+*])?/g, (_m, slash: string, name: string, group?: string, mod?: string) => {
    names.push(name);
    if (mod === '*') return `(?:${slash}(.*))?`;
    if (group) return `${slash}${group}`;
    if (mod === '+') return `${slash}(.+)`;
    return `${slash}([^/]+)`;
  });
  return { re: new RegExp(`^${pattern}$`), names };
}

function route(path: string): string | null {
  for (const rule of config.rewrites) {
    const { re, names } = compile(rule.source);
    const m = re.exec(path);
    if (!m) continue;
    return rule.destination.replace(/:(\w+)/g, (_x, name: string) => m[names.indexOf(name) + 1] ?? '');
  }
  return null;
}

describe('hosting routes for path URLs', () => {
  it('drops trailing slashes', () => {
    expect(config.trailingSlash).toBe(false);
  });

  it.each([
    // bare fixed pages and states are static files: no rewrite touches them
    ['/how', null],
    ['/faq', null],
    ['/changelog', null],
    ['/privacy', null],
    ['/changelog/x', null],
    ['/pledges', null],
    ['/privacy', null],
    ['/remove', null],
    ['/CO', null],
    // files, assets and data are never rewritten
    ['/data/CO/og.png', null],
    ['/data/index.json', null],
    ['/assets/x.js', null],
    // case and length of the state segment
    ['/CO/house', '/CO/index.html'],
    ['/CO/senate', '/CO/index.html'],
    ['/Co/x', '/index.html'],
    ['/Co', '/index.html'],
    ['/ab/x', '/index.html'],
    ['/XX/x', '/XX/index.html'],
    ['/X/x', null],
    ['/COL/x', null],
    ['/how/balancing', '/how/index.html'],
    ['/faq/ties', '/faq/index.html'],
    ['/house', '/index.html'],
    ['/CO/senate/d/12', '/CO/senate/index.html'],
    ['/CO/d/3', '/CO/index.html'],
    ['/co/d/3', '/index.html'],
    ['/wp-admin/x', null],
  ])('routes %s to %s', (path, expected) => {
    expect(route(path)).toBe(expected);
  });

  describe('Content-Security-Policy', () => {
    const fromVercel = (JSON.parse(readFileSync('vercel.json', 'utf8')) as { headers: { source: string; headers: { key: string; value: string }[] }[] }).headers
      .find((h) => h.source === '/(.*)')!
      .headers.find((h) => h.key === 'Content-Security-Policy')!.value;
    const fromFile = /^\s+Content-Security-Policy:\s*(.+)$/m.exec(readFileSync('public/_headers', 'utf8'))![1]!.trim();
    const directive = (policy: string, name: string): string[] => (policy.split(';').map((d) => d.trim().split(/\s+/)).find((d) => d[0] === name) ?? []).slice(1);

    it('is the same in vercel.json and public/_headers', () => {
      expect(fromFile).toBe(fromVercel);
    });
    it('lets the Turnstile script load and frame, and nothing else leave the site', () => {
      expect(directive(fromVercel, 'script-src')).toContain('https://challenges.cloudflare.com');
      expect(directive(fromVercel, 'frame-src')).toEqual(['https://challenges.cloudflare.com']);
      expect(directive(fromVercel, 'connect-src')).toEqual(["'self'", 'blob:']);
    });
  });

  it('has a prerendered file for every fixed page, with its title, canonical link and one viewer root', () => {
    for (const [key, { path, title }] of Object.entries(PAGE_META)) {
      const file = `dist${path === '/' ? '' : path}/index.html`;
      expect(existsSync(file)).toBe(true);
      const html = readFileSync(file, 'utf8');
      expect(/<title>([^<]*)<\/title>/.exec(html)?.[1]).toBe(title);
      expect(html).toContain(`<link rel="canonical" href="https://fairmaps.melson.us${path === '/' ? '/' : path}" />`);
      expect(html.match(/id="str-viewer"/g), key).toHaveLength(1);
      if (key === 'how' || key === 'changelog') expect(html).not.toContain('FAQPage');
    }
  });

  describe('_redirects', () => {
    // vercel.json rules written the way a _redirects file writes them: a constrained group becomes a bare name, a
    // trailing :rest+ or :rest* becomes `*`, and a word alternation becomes one line per word.
    function asRedirects(rule: Rewrite): string[] {
      const alt = /:(\w+)\((\w+(?:\|\w+)+)\)/.exec(rule.source);
      if (alt) {
        return alt[2]!.split('|').flatMap((word) =>
          asRedirects({ source: rule.source.replace(alt[0], word), destination: rule.destination.replace(`:${alt[1]}`, word) }),
        );
      }
      const source = rule.source.replace(/(:\w+)\([^)]*\)/g, '$1').replace(/\/:\w+[+*]$/, '/*');
      return [`${source} ${rule.destination}`];
    }

    const lines = readFileSync('public/_redirects', 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l !== '' && !l.startsWith('#'))
      .map((l) => l.split(/\s+/));
    const redirects = lines.map(([from, to]) => `${from} ${to}`);

    // Documented difference: _redirects cannot tell a mixed-case code from a state code, so the client-side lowercase
    // route rule has no counterpart there (the catch-all /:st/* serves that case from the state page).
    const NO_COUNTERPART = new Set(['/:st([a-z][a-zA-Z]|[A-Z][a-z])/:rest*']);

    it('serves every line with status 200', () => {
      for (const l of lines) expect(l[2]).toBe('200');
    });
    it('has a line for every vercel.json rewrite', () => {
      for (const rule of config.rewrites) {
        if (NO_COUNTERPART.has(rule.source)) continue;
        for (const expected of asRedirects(rule)) expect(redirects, rule.source).toContain(expected);
      }
    });
    it('has no line without a rewrite behind it', () => {
      const known = new Set(config.rewrites.filter((r) => !NO_COUNTERPART.has(r.source)).flatMap(asRedirects));
      for (const r of redirects) expect(known.has(r), r).toBe(true);
    });
  });
});
