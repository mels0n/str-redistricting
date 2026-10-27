import { h, routeHref, censusLabel, feedbackHref, CHANGELOG, PRIVACY, VERSIONS, loadPublishedVersions, type Versions } from '../../shared';

const line = (v: Versions): string => `Maps release ${v.maps} · Engine ${v.engine} · ${censusLabel(v.input.vintage)} (r${v.input.revision}) · Site ${VERSIONS.web}`;

/**
 * A link to what changed in each release. It names the versions behind the maps only once the published data says
 * what they are (public/data/versions.json); until then it claims nothing. The site's own version is the code's.
 * Under it, the two ways to reach the project: a question, or a problem report, each on its own GitHub form, and
 * what the site collects.
 */
export function createSiteFooter(): HTMLElement {
  const link = h('a', { href: routeHref(CHANGELOG), class: 'strv-footer__link' }, 'Changelog');
  void loadPublishedVersions().then((v) => {
    if (v !== null) link.textContent = line(v);
  });
  const reach = h(
    'p',
    { class: 'strv-footer__reach' },
    'Questions or problems? ',
    h('a', { href: feedbackHref('question'), class: 'strv-footer__link' }, 'Ask a question'),
    ' · ',
    h('a', { href: feedbackHref('problem'), class: 'strv-footer__link' }, 'Report a problem'),
    ' on GitHub. ',
    h('a', { href: routeHref(PRIVACY), class: 'strv-footer__link' }, 'Privacy'),
  );
  return h('footer', { class: 'strv-footer' }, h('p', null, link), reach);
}
