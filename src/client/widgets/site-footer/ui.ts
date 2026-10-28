import { h, routeHref, censusLabel, feedbackHref, CHANGELOG, PRIVACY, VERSIONS, loadPublishedVersions, type Versions } from '../../shared';

const line = (v: Versions): string => `Maps release ${v.maps} · Engine ${v.engine} · ${censusLabel(v.input.vintage)} (r${v.input.revision}) · Site ${VERSIONS.web}`;

/**
 * Two lines. The first names the versions behind the maps, only once the published data says what they are
 * (public/data/versions.json); until then it is empty and claims nothing. The site's own version is the code's.
 * The second is one row of links: the changelog, the two ways to reach the project (a question, or a problem report,
 * each on its own GitHub form) and what the site collects.
 */
export function createSiteFooter(): HTMLElement {
  const versions = h('p', { class: 'strv-footer__versions', hidden: true });
  void loadPublishedVersions().then((v) => {
    if (v === null) return;
    versions.textContent = line(v);
    versions.hidden = false;
  });
  const link = (href: string, text: string): HTMLElement => h('li', null, h('a', { href, class: 'strv-footer__link' }, text));
  const links = h(
    'ul',
    { class: 'strv-footer__links', 'aria-label': 'More' },
    link(routeHref(CHANGELOG), 'Changelog'),
    link(feedbackHref('question'), 'Ask a question'),
    link(feedbackHref('problem'), 'Report a problem on GitHub'),
    link(routeHref(PRIVACY), 'Privacy'),
  );
  return h('footer', { class: 'strv-footer' }, versions, links);
}
