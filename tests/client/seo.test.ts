// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { jsonLd, jsonLdScript } from '../../build/seo';

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
