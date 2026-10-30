// @vitest-environment jsdom
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createPrivacyPage } from '../../src/client/pages/privacy';
import { ANALYTICS_FILTER_SRC, ANALYTICS_SRC, analyticsTags, webAnalytics } from '../../build/web-analytics';

const vercel = JSON.parse(readFileSync('vercel.json', 'utf8')) as { headers: { source: string; headers: { key: string; value: string }[] }[] };
const header = (key: string): string => vercel.headers.flatMap((h) => h.headers).find((h) => h.key === key)?.value ?? '';
const directive = (csp: string, name: string): string[] => csp.split(';').map((d) => d.trim().split(/\s+/)).find((d) => d[0] === name)?.slice(1) ?? [];

describe('privacy page', () => {
  it('has a heading, a section per topic and no em dash', () => {
    const page = createPrivacyPage();
    expect(page.focusTarget()?.textContent).toBe('Privacy');
    expect([...page.el.querySelectorAll('h2')].map((h) => h.textContent)).toEqual([
      'What we collect',
      'What we never keep',
      'What is public',
      'Who sees your email',
      'How to be removed',
      'Services we use',
      'Visit counts',
      'Address lookups',
      'The badge',
      'Kept in your browser',
      'Hosting',
      'Nothing else',
    ]);
    expect(page.el.textContent).not.toContain('—');
  });

  it('says exactly what is kept about a site that shows the badge, and how long', () => {
    const text = createPrivacyPage().el.textContent!;
    expect(text).toContain('We keep that page address, the page’s title, the address where we found the badge, and when we saw and checked it.');
    expect(text).toContain('We don’t keep who was visiting: no IP address, no cookies.');
    expect(text).toContain('A page we have not seen for 60 days is deleted, and a site whose check fails two days in a row comes off the list.');
  });

  it('links the Census Bureau and Vercel privacy policies and the question form', () => {
    const hrefs = [...createPrivacyPage().el.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('https://www.census.gov/about/policies/privacy.html');
    expect(hrefs).toContain('https://vercel.com/legal/privacy-policy');
    expect(hrefs).toContain('https://github.com/mels0n/str-redistricting/issues/new?template=question.yml');
  });
});

describe('what the page claims holds for the hosting policy', () => {
  it('loads scripts only from the site, the Census geocoder and the Turnstile bot check, the outside services the page names', () => {
    const csp = header('Content-Security-Policy');
    expect(directive(csp, 'script-src')).toEqual(["'self'", 'https://geocoding.geo.census.gov', 'https://challenges.cloudflare.com']);
    expect(directive(csp, 'frame-src')).toEqual(['https://challenges.cloudflare.com']);
  });

  it('fetches nothing from other sites and loads no outside fonts', () => {
    const csp = header('Content-Security-Policy');
    expect(directive(csp, 'connect-src')).toEqual(["'self'", 'blob:']);
    expect(directive(csp, 'font-src')).toEqual(["'self'"]);
  });

  it('sends no referrer', () => {
    expect(header('Referrer-Policy')).toBe('no-referrer');
  });
});

describe('web analytics tags', () => {
  it('load the path-only hook, then the counter, from the site’s own origin, deferred, in built pages only', () => {
    expect(analyticsTags()).toEqual([
      { tag: 'script', attrs: { defer: true, src: '/va-path-only.js' }, injectTo: 'body' },
      { tag: 'script', attrs: { defer: true, src: '/_vercel/insights/script.js' }, injectTo: 'body' },
    ]);
    expect(webAnalytics().apply).toBe('build');
  });

  const SHARE_PAGE = 'dist/CO/index.html';
  it.each(['dist/index.html', 'dist/faq/index.html', 'dist/privacy/index.html', 'dist/404.html', SHARE_PAGE])('are in %s once each, hook first', (file) => {
    const html = readFileSync(file, 'utf8');
    const count = (src: string): number => html.split(`src="${src}"`).length - 1;
    expect(count(ANALYTICS_FILTER_SRC)).toBe(1);
    expect(count(ANALYTICS_SRC)).toBe(1);
    expect(html.indexOf(ANALYTICS_FILTER_SRC)).toBeLessThan(html.indexOf(ANALYTICS_SRC));
  });

  it('are not in the source page the dev server serves', () => {
    const html = readFileSync('index.html', 'utf8');
    expect(html).not.toContain(ANALYTICS_SRC);
    expect(html).not.toContain(ANALYTICS_FILTER_SRC);
  });
});

describe('path-only hook', () => {
  const run = (win: Record<string, unknown>): void => {
    new Function('window', 'URL', readFileSync('public/va-path-only.js', 'utf8'))(win, URL);
  };
  type Hook = (e: { type: string; url: string }) => { type: string; url: string };

  it('queues a beforeSend that drops the query and fragment when the counter has not loaded yet', () => {
    const win: Record<string, unknown> = {};
    run(win);
    const [name, hook] = (win.vaq as [string, Hook][])[0]!;
    expect(name).toBe('beforeSend');
    expect(hook({ type: 'pageview', url: 'https://fairmaps.melson.us/CO/d/3?fbclid=abc&utm_source=x#top' })).toEqual({ type: 'pageview', url: 'https://fairmaps.melson.us/CO/d/3' });
  });

  it('registers directly when the counter is already there', () => {
    const calls: unknown[][] = [];
    const win: Record<string, unknown> = { va: (...a: unknown[]) => calls.push(a) };
    run(win);
    expect(calls[0]?.[0]).toBe('beforeSend');
    expect(win.vaq).toBeUndefined();
  });
});

describe('what the page says is kept in the browser', () => {
  const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? files(join(dir, d.name)) : d.name.endsWith('.ts') ? [join(dir, d.name).replaceAll('\\', '/')] : []));
  const using = (pattern: RegExp): string[] => files('src/client').filter((f) => pattern.test(readFileSync(f, 'utf8')));

  it('is the divider sizes in local storage, the reload note in session storage, and no cookies', () => {
    expect(using(/localStorage/)).toEqual(['src/client/shared/lib/split.ts']);
    expect(using(/sessionStorage/)).toEqual(['src/client/app/main.ts']);
    expect(using(/document\.cookie|indexedDB/)).toEqual([]);
  });
});
