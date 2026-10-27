// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createPrivacyPage } from '../../src/client/pages/privacy';
import { ANALYTICS_SRC, analyticsTag, webAnalytics } from '../../build/web-analytics';

const vercel = JSON.parse(readFileSync('vercel.json', 'utf8')) as { headers: { source: string; headers: { key: string; value: string }[] }[] };
const header = (key: string): string => vercel.headers.flatMap((h) => h.headers).find((h) => h.key === key)?.value ?? '';
const directive = (csp: string, name: string): string[] => csp.split(';').map((d) => d.trim().split(/\s+/)).find((d) => d[0] === name)?.slice(1) ?? [];

describe('privacy page', () => {
  it('has a heading, a section per topic and no em dash', () => {
    const page = createPrivacyPage();
    expect(page.focusTarget()?.textContent).toBe('Privacy');
    expect([...page.el.querySelectorAll('h2')].map((h) => h.textContent)).toEqual(['Visit counts', 'Address lookups', 'Kept in your browser', 'Hosting', 'Nothing else']);
    expect(page.el.textContent).not.toContain('—');
  });

  it('links the Census Bureau and Vercel privacy policies and the issue tracker', () => {
    const hrefs = [...createPrivacyPage().el.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('https://www.census.gov/about/policies/privacy.html');
    expect(hrefs).toContain('https://vercel.com/legal/privacy-policy');
    expect(hrefs).toContain('https://github.com/mels0n/str-redistricting/issues');
  });
});

describe('what the page claims holds for the hosting policy', () => {
  it('loads scripts only from the site and the Census geocoder, the one outside service the page names', () => {
    expect(directive(header('Content-Security-Policy'), 'script-src')).toEqual(["'self'", 'https://geocoding.geo.census.gov']);
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

describe('web analytics tag', () => {
  it('loads the counter from the site’s own origin, deferred, in built pages only', () => {
    expect(ANALYTICS_SRC.startsWith('/')).toBe(true);
    expect(analyticsTag()).toEqual({ tag: 'script', attrs: { defer: true, src: '/_vercel/insights/script.js' }, injectTo: 'body' });
    expect(webAnalytics().apply).toBe('build');
  });
});
