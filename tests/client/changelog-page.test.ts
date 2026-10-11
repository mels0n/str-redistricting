// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderChangelog } from '../../src/client/shared/lib/markdown';
import { createChangelogPage } from '../../src/client/pages/changelog';

describe('renderChangelog', () => {
  it('renders headings, bullets and paragraphs', () => {
    const el = renderChangelog('# Title\n\n## 1.0.0\n\nIntro text.\n\n- one\n- two\n');
    expect(el.querySelector('h2')?.textContent).toBe('Title');
    expect(el.querySelector('h3')?.textContent).toBe('1.0.0');
    expect(el.querySelector('p')?.textContent).toBe('Intro text.');
    expect([...el.querySelectorAll('li')].map((l) => l.textContent)).toEqual(['one', 'two']);
  });

  it('keeps http(s) and in-app links', () => {
    const el = renderChangelog('- [a](https://example.com/x) and [b](#/how)');
    const links = [...el.querySelectorAll('a')];
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['https://example.com/x', '#/how']);
  });

  it('turns javascript: and other schemes into plain text', () => {
    const el = renderChangelog('- [bad](javascript:alert(1)) [data](data:text/html,x) [rel](/x)');
    expect(el.querySelector('a')).toBeNull();
    expect(el.textContent).toContain('bad');
    expect(el.innerHTML).not.toContain('javascript:');
  });

  it('never makes elements from markup in the text', () => {
    const el = renderChangelog('- <img src=x onerror=alert(1)>');
    expect(el.querySelector('img')).toBeNull();
  });
});

describe('changelog page', () => {
  it('shows the h1, intro and six section headings in README order', () => {
    const page = createChangelogPage();
    expect(page.el.querySelector('h1')?.textContent).toBe('Changelog');
    expect(page.el.textContent).toContain('What changed in each release of the code that draws the maps, the Census files they are drawn from, the maps, the file formats, this site and the documentation.');
    expect([...page.el.querySelectorAll('h2')].map((x) => x.textContent)).toEqual([
      'Engine changelog', 'Input changelog', 'Maps changelog', 'Schema changelog', 'Web changelog', 'Docs changelog',
    ]);
    expect(page.focusTarget()).toBe(page.el.querySelector('h1'));
  });

  it('says so when a section has no releases', () => {
    const empty = (t: string): string => `# ${t} changelog\n\n`;
    const page = createChangelogPage({
      engine: '# Engine changelog\n\n## 1.0.0\n\n- x\n', input: empty('Input'), maps: empty('Maps'),
      schema: '# Schema changelog\n\n## 1.0.0\n\n- y\n', web: empty('Web'), docs: empty('Docs'),
    });
    expect(page.el.textContent?.match(/No releases yet\./g)?.length).toBe(4);
  });
});
