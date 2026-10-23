import { h, PAGE_META, routeHref, iconArrowLeft, renderChangelog, NATIONAL, type Page } from '../../shared';
import engine from '../../../../changelog/engine.md?raw';
import input from '../../../../changelog/input.md?raw';
import maps from '../../../../changelog/maps.md?raw';
import schema from '../../../../changelog/schema.md?raw';
import web from '../../../../changelog/web.md?raw';
import docs from '../../../../changelog/docs.md?raw';

/** One changelog file per versioned component, listed in the README's table order. */
export interface ChangelogSources {
  engine: string;
  input: string;
  maps: string;
  schema: string;
  web: string;
  docs: string;
}

const DEFAULT_SOURCES: ChangelogSources = { engine, input, maps, schema, web, docs };

/** True when the file has a title but no release under it. */
function isEmpty(md: string): boolean {
  return md.replace(/^#[ \t].*$/m, '').trim() === '';
}

export function createChangelogPage(sources: ChangelogSources = DEFAULT_SOURCES): Page {
  const h1 = h('h1', { class: 'strv-how__h1', tabindex: -1 }, 'Changelog');
  const sections = [sources.engine, sources.input, sources.maps, sources.schema, sources.web, sources.docs].map((md) => {
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
      h('a', { href: routeHref(NATIONAL), class: 'strv-back' }, iconArrowLeft(), 'All states'),
      h1,
      h('p', { class: 'strv-how__lede' }, 'What changed in each release of the code that draws the maps, the Census files they are drawn from, the maps, the file formats, this site and the documentation.'),
    ),
    h('div', { class: 'strv-changelog__body' }, sections),
  );
  document.title = PAGE_META.changelog.title;
  return { el, focusTarget: () => h1, destroy() {} };
}
