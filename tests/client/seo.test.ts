// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { toMarkdown } from '../../build/markdown';
import { jsonLd, jsonLdScript, llmsTxt, robotsTxt, sitemapXml } from '../../build/seo';

describe('structured data builders', () => {
  it('escapes < so a value cannot close the script tag', () => {
    const tag = jsonLdScript([{ a: '</script>' }]);
    const inner = tag.slice('<script type="application/ld+json">'.length, -'</script>'.length);
    expect(inner).not.toContain('</script>');
    expect(inner).not.toContain('<');
    expect(JSON.parse(inner)).toEqual({ a: '</script>' });
  });

  it('has none for the changelog and an empty list renders nothing', () => {
    expect(jsonLd('changelog', [])).toEqual([]);
    expect(jsonLdScript([])).toBe('');
  });

  it('describes the home page as a site and a dataset', () => {
    expect(jsonLd('home', []).map((o) => (o as { '@type': string })['@type'])).toEqual(['WebSite', 'Dataset']);
  });
});

describe('site files', () => {
  it('lists the four pages in the sitemap with no lastmod', () => {
    const xml = sitemapXml('https://x.test');
    expect(xml.match(/<loc>/g)).toHaveLength(4);
    expect(xml).toContain('<loc>https://x.test/faq</loc>');
    expect(xml).not.toContain('lastmod');
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
});
