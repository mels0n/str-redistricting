// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderPage } from '../../build/prerender';
import { PAGE_META } from '../../src/client/shared/lib/page-meta';

const read = (p: string): string => readFileSync(p, 'utf8');
const titleOf = (html: string): string => /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? '';

describe('prerendered pages', () => {
  it('renders the FAQ with its first answer and no inline styles', async () => {
    const { html, faq } = await renderPage('faq');
    expect(html).toContain('What is gerrymandering?');
    expect(html).toContain('pack one side’s voters');
    expect(html).not.toContain(' style="');
    expect(faq[0]?.q).toBe('What is gerrymandering?');
    expect(faq).toHaveLength(16);
  });

  it('keeps every glossary term in the answer to the terms question', async () => {
    const { faq } = await renderPage('faq');
    const terms = faq.find((f) => f.q === 'What do the other terms mean?');
    expect(terms?.a).toContain('Census block: The smallest area');
    expect(terms?.a).toContain('Fair: Made by a rule nobody can aim');
    expect(terms?.a).toContain('Proportional: Seats shared out');
    expect(terms?.a.length).toBeGreaterThan(300);
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
    const data = JSON.parse(scripts[0]![1]!) as { '@graph': { '@type': string; mainEntity?: unknown }[] };
    const faqPage = data['@graph'].find((n) => n['@type'] === 'FAQPage');
    expect(faqPage?.mainEntity).toHaveLength(16);
    expect(html).not.toMatch(/<[^>]* style="/);
  });

  it('writes the home file and the not-found page', () => {
    expect(titleOf(read('dist/index.html'))).toBe(PAGE_META.home.title);
    const missing = read('dist/404.html');
    expect(missing).toContain('<meta name="robots" content="noindex">');
    expect(titleOf(missing)).toBe('Page not found | Fair Maps');
    expect(missing).toContain('<a href="/">Go to Fair Maps</a>');
    expect(missing).toContain('<div id="str-viewer" class="strv">');
    expect(missing).not.toMatch(/type="module"/);
  });

  it('writes the icons and the full text for language models', () => {
    expect([...readFileSync('dist/favicon.ico').subarray(0, 6)]).toEqual([0, 0, 1, 0, 1, 0]);
    expect([...readFileSync('dist/apple-touch-icon.png').subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const full = read('dist/llms-full.txt');
    expect(full).toContain('## What is gerrymandering?');
    expect(full).toContain('pack one side’s voters');
    expect(full).not.toContain('Skip to content');
    expect(full).not.toContain('Loading');
    expect(full).not.toContain('Epasses');
    expect(full).not.toContain('1chosen');
    expect(full).toContain('(passes the share)');
    expect(full).not.toContain('Census blockThe');
    expect(full).toContain('- **Census block**: The smallest area');
    const ico = readFileSync('dist/favicon.ico');
    expect([ico[6], ico[7], ico.readUInt16LE(10), ico.readUInt16LE(12), ico.readUInt32LE(14), ico.readUInt32LE(18)]).toEqual([48, 48, 1, 32, ico.length - 22, 22]);
    expect(readFileSync('dist/apple-touch-icon.png').readUInt32BE(16)).toBe(180);
    expect(read('dist/robots.txt')).toContain('Sitemap:');
  });
});
