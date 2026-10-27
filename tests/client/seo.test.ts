// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { toMarkdown } from '../../build/markdown';
import { PAGE_KEYS, jsonLd, jsonLdScript, llmsTxt, robotsTxt, sitemapXml } from '../../build/seo';
import { FAQ_QUESTIONS, PAGE_META } from '../../src/client/shared';

describe('structured data builders', () => {
  it('escapes < so a value cannot close the script tag', () => {
    const tag = jsonLdScript([{ a: '</script>' }]);
    const inner = tag.slice('<script type="application/ld+json">'.length, -'</script>'.length);
    expect(inner).not.toContain('</script>');
    expect(inner).not.toContain('<');
    expect(JSON.parse(inner)).toEqual({ a: '</script>' });
  });

  it('renders an empty list as nothing', () => {
    expect(jsonLdScript([])).toBe('');
  });

});

describe('site files', () => {
  it('lists the four pages in the sitemap with no lastmod', () => {
    const xml = sitemapXml('https://x.test');
    expect(xml.match(/<loc>/g)).toHaveLength(4);
    expect(xml).toContain('<loc>https://x.test/</loc>');
    expect(xml).toContain('<loc>https://x.test/faq</loc>');
    expect(xml).not.toContain('lastmod');
  });

  it('lists each share page after the fixed pages', () => {
    const xml = sitemapXml('https://x.test', ['CO', 'CO/house', 'CO/senate']);
    const locs = [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]);
    expect(locs).toHaveLength(7);
    expect(locs.slice(4)).toEqual(['https://x.test/CO', 'https://x.test/CO/house', 'https://x.test/CO/senate']);
  });

  it('ends robots.txt with the sitemap line and keeps em dashes out', () => {
    const robots = robotsTxt('https://fairmaps.melson.us');
    expect(robots.trimEnd().endsWith('Sitemap: https://fairmaps.melson.us/sitemap.xml')).toBe(true);
    expect(robots).not.toContain('—');
    expect(llmsTxt('https://x.test')).toContain('https://x.test/faq/stop');
    expect(llmsTxt('https://x.test')).not.toContain('—');
  });

  it('converts prerendered markup to markdown', () => {
    const html = '<h2>Q<span class="strv-how__no" aria-hidden="true">1</span></h2><p>See <a href="/how">How</a></p><svg></svg>';
    expect(toMarkdown(html, 'https://x.test')).toBe('## Q\n\nSee [How](https://x.test/how)\n');
  });

  it('converts lists, tables, strong text and badges', () => {
    const site = 'https://x.test';
    expect(toMarkdown('<ul><li>a</li><li>b</li></ul><ol><li>c</li><li>d</li></ol>', site)).toBe('- a\n- b\n\n1. c\n2. d\n');
    expect(toMarkdown('<table><tr><th>H</th><th>I</th></tr><tr><td>a|b</td><td>2</td></tr></table>', site)).toBe('| H | I |\n| --- | --- |\n| a\\|b | 2 |\n');
    expect(toMarkdown('<p>so <strong>bold</strong> move</p>', site)).toBe('so **bold** move\n');
    expect(toMarkdown('<p>E<span class="strv-how__flag">passes</span></p><p class="strv-loading">Loading</p><a class="strv-skip" href="\\m">Skip</a>', site)).toBe('E (passes)\n');
  });
});

describe('single sources', () => {
  it('walks every fixed page once, in PAGE_META order', () => {
    expect(PAGE_KEYS).toEqual(Object.keys(PAGE_META));
  });
  it('names only real FAQ questions in llms.txt', () => {
    const slugs = [...llmsTxt('https://x.test').matchAll(/https:\/\/x\.test\/faq\/([^)\s]+)/g)].map((m) => m[1]);
    expect(slugs.length).toBeGreaterThan(0);
    for (const slug of slugs) expect(FAQ_QUESTIONS as readonly (string | undefined)[]).toContain(slug);
  });
  it('keeps the source index.html head equal to PAGE_META.home', () => {
    const html = readFileSync('index.html', 'utf8');
    const content = (re: RegExp): string | undefined => re.exec(html)?.[1];
    expect(content(/<title>([^<]*)<\/title>/)).toBe(PAGE_META.home.title);
    expect(content(/<meta name="description" content="([^"]*)"/)).toBe(PAGE_META.home.description);
    expect(content(/<meta property="og:title" content="([^"]*)"/)).toBe(PAGE_META.home.title);
    expect(content(/<meta property="og:description" content="([^"]*)"/)).toBe(PAGE_META.home.description);
  });
});
