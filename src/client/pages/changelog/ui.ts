import { h, formatHash, iconArrowLeft, renderChangelog, NATIONAL, type Page } from '../../shared';
import maps from '../../../../changelog/maps.md?raw';
import engine from '../../../../changelog/engine.md?raw';
import input from '../../../../changelog/input.md?raw';

export interface ChangelogSources {
  maps: string;
  engine: string;
  input: string;
}

const DEFAULT_SOURCES: ChangelogSources = { maps, engine, input };

/** True when the file has a title but no release under it. */
function isEmpty(md: string): boolean {
  return md.replace(/^#[ \t].*$/m, '').trim() === '';
}

export function createChangelogPage(sources: ChangelogSources = DEFAULT_SOURCES): Page {
  const h1 = h('h1', { class: 'strv-how__h1', tabindex: -1 }, 'Changelog');
  const sections = [sources.maps, sources.engine, sources.input].map((md) => {
    const body = renderChangelog(md);
    if (isEmpty(md)) body.append(h('p', { class: 'strv-changelog__empty' }, 'No releases yet.'));
    return h('section', { class: 'strv-changelog__section' }, body);
  });
  const el = h(
    'main',
    { class: 'strv-how strv-changelog', id: 'strv-main' },
    h(
      'header',
      { class: 'strv-how__head' },
      h('a', { href: formatHash(NATIONAL), class: 'strv-back' }, iconArrowLeft(), 'All states'),
      h1,
      h('p', { class: 'strv-how__lede' }, 'What changed in each release of the maps, the code that draws them, and the Census files they are drawn from.'),
    ),
    h('div', { class: 'strv-changelog__body' }, sections),
  );
  document.title = 'Changelog | Fair Maps';
  return { el, focusTarget: () => h1, destroy() {} };
}
