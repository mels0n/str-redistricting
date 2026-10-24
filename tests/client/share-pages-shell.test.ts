import { describe, expect, it } from 'vitest';
import { sharePageHtml } from '../../build/share-pages';
import { SHELL } from '../helpers/shell';

const CO = { abbr: 'CO', name: 'Colorado', seats: 8 };
const SENATE = { abbr: 'CO', name: 'Colorado', seats: 35, chamber: 'state-senate' } as const;
const SITE = 'https://example.test';

describe('sharePageHtml on the built shell', () => {
  it('keeps the shell and swaps the state tags, with no redirect', () => {
    const page = sharePageHtml(SENATE, SITE, SHELL);
    expect(page).not.toContain('http-equiv="refresh"');
    expect(page).toContain('<div id="str-viewer"></div>');
    expect(page).toContain('<base href="/" />');
    expect(page).toContain('<link rel="canonical" href="https://example.test/CO/senate" />');
    expect(page).toContain('<meta property="og:url" content="https://example.test/CO/senate" />');
    expect(page).toContain('<title>Colorado State Senate: districts drawn by Fair Maps</title>');
    expect(page).toContain('/data/CO/state-senate/og.png');
    expect(page).not.toContain('Home ');
  });
  it('uses no trailing slash for the federal House page', () => {
    expect(sharePageHtml(CO, SITE, SHELL)).toContain('<link rel="canonical" href="https://example.test/CO" />');
  });
  it('names the missing tag when the shell lacks one', () => {
    expect(() => sharePageHtml(CO, SITE, SHELL.replace(/<link rel="canonical"[^>]*>/, ''))).toThrow(/canonical/);
    expect(() => sharePageHtml(CO, SITE, SHELL.replace(/<title>.*<\/title>/, ''))).toThrow(/title/);
  });
});
