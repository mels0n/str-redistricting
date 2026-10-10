import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sharePageHtml, writeSharePages } from '../../../build/share-pages.js';
import { TAGLINE } from '../../../src/server/features/publish/site.js';

describe('sharePageHtml', () => {
  const html = sharePageHtml({ abbr: 'CO', name: 'Colorado', seats: 8 }, 'https://fairmaps.melson.us', true);
  it('has the exact tags', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<meta charset="utf-8" />');
    expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1" />');
    expect(html).toContain('<title>Colorado: districts drawn by Fair Maps</title>');
    expect(html).toContain("Colorado's 8 congressional districts, drawn from 2020 Census counts by three fixed steps nobody can steer.");
    expect(html).toContain(`<meta property="og:description" content="Colorado's 8 congressional districts, drawn from 2020 Census counts by three fixed steps nobody can steer. ${TAGLINE}" />`);
    expect(html).toContain('<link rel="canonical" href="https://fairmaps.melson.us/CO/" />');
    expect(html).toContain('<meta property="og:url" content="https://fairmaps.melson.us/CO/" />');
    expect(html).toContain('<meta property="og:image" content="https://fairmaps.melson.us/data/CO/og.png" />');
    expect(html).toContain('<meta property="og:image:width" content="1200" />');
    expect(html).toContain('<meta property="og:image:height" content="630" />');
    expect(html).toContain('<meta property="og:image:alt"');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image" />');
    expect(html).toContain('<meta http-equiv="refresh" content="0; url=../#/CO" />');
    expect(html).toContain('<a href="../#/CO">Open the Colorado map</a>');
  });
  it('falls back to the site image when the state has none', () => {
    const fallback = sharePageHtml({ abbr: 'CO', name: 'Colorado', seats: 8 }, 'https://fairmaps.melson.us', false);
    expect(fallback).toContain('content="https://fairmaps.melson.us/og-image.png"');
    expect(fallback).not.toContain('/data/CO/og.png');
  });
  it('escapes values, has no script, no em dash', () => {
    const amp = sharePageHtml({ abbr: 'XX', name: 'A & "B" <c>', seats: 1 }, 'https://fairmaps.melson.us', true);
    expect(amp).toContain('A &amp; &quot;B&quot; &lt;c&gt;');
    expect(amp).not.toContain('<c>');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('—');
  });
});

describe('writeSharePages', () => {
  it('writes one page per state with data, using og.png only where it exists', () => {
    const root = mkdtempSync(join(tmpdir(), 'share-'));
    const pub = join(root, 'public');
    const dist = join(root, 'dist');
    mkdirSync(join(pub, 'data', 'CO'), { recursive: true });
    writeFileSync(join(pub, 'data', 'CO', 'og.png'), 'x');
    writeFileSync(join(pub, 'data', 'index.json'), JSON.stringify({ states: [
      { abbr: 'CO', name: 'Colorado', seats: 8, hasData: true },
      { abbr: 'RI', name: 'Rhode Island', seats: 2, hasData: true },
      { abbr: 'WY', name: 'Wyoming', seats: 1, hasData: false },
    ] }));
    expect(writeSharePages(pub, dist)).toEqual(['CO', 'RI']);
    expect(readFileSync(join(dist, 'CO', 'index.html'), 'utf8')).toContain('/data/CO/og.png');
    expect(readFileSync(join(dist, 'RI', 'index.html'), 'utf8')).toContain('/og-image.png');
    expect(existsSync(join(dist, 'WY'))).toBe(false);
  });
});
