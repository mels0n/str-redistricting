// @vitest-environment node
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { renderPage } from '../../build/prerender';
import { PAGE_META } from '../../src/client/shared/lib/page-meta';

const read = (p: string): string => readFileSync(p, 'utf8');
const titleOf = (html: string): string => /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? '';

describe('prerendered pages', () => {
  beforeAll(() => {
    execSync('npm run build', { stdio: 'ignore' });
  }, 120_000);

  it('renders the FAQ with its first answer and no inline styles', async () => {
    const { html, faq } = await renderPage('faq');
    expect(html).toContain('What is gerrymandering?');
    expect(html).toContain('pack one side’s voters');
    expect(html).not.toContain(' style="');
    expect(faq[0]?.q).toBe('What is gerrymandering?');
    expect(faq).toHaveLength(15);
  });

  it('renders the home page headline and a link into the FAQ', async () => {
    const { html } = await renderPage('home');
    expect(html).toContain('Voters should pick their politicians.');
    expect(html).toContain('href="/faq/stop"');
  });

  it('renders the How it works sections', async () => {
    expect((await renderPage('how')).html).toContain('strv-how__section');
  });

  it('writes the FAQ file with its head, one viewer root and FAQPage data', () => {
    const html = read('dist/faq/index.html');
    expect(titleOf(html)).toBe(PAGE_META.faq.title);
    expect(html).toContain('<link rel="canonical" href="https://fairmaps.melson.us/faq" />');
    expect(html.match(/id="str-viewer"/g)).toHaveLength(1);
    const scripts = [...html.matchAll(/<script type="application\/ld\+json">([^<]*)<\/script>/g)];
    expect(scripts).toHaveLength(1);
    const data = JSON.parse(scripts[0]![1]!) as { '@type': string; mainEntity: unknown[] };
    expect(data['@type']).toBe('FAQPage');
    expect(data.mainEntity).toHaveLength(15);
    expect(html).not.toMatch(/<[^>]* style="/);
  });

  it('writes the home file and the not-found page', () => {
    expect(titleOf(read('dist/index.html'))).toBe(PAGE_META.home.title);
    const missing = read('dist/404.html');
    expect(missing).toContain('<meta name="robots" content="noindex">');
    expect(titleOf(missing)).toBe('Page not found | Fair Maps');
    expect(missing).toContain('<a href="/">Go to Fair Maps</a>');
  });
});
