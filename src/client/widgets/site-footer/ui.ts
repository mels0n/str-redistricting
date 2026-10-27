import { h, routeHref, PRIVACY, REMOVE, censusLabel, CHANGELOG, VERSIONS, loadPublishedVersions, type Versions } from '../../shared';

const line = (v: Versions): string => `Maps release ${v.maps} · Engine ${v.engine} · ${censusLabel(v.input.vintage)} (r${v.input.revision}) · Site ${VERSIONS.web}`;

/**
 * Links to what changed in each release and to the privacy page and the page that removes a signature. It names the versions behind the maps only once the published data says
 * what they are (public/data/versions.json); until then it claims nothing. The site's own version is the code's.
 */
export function createSiteFooter(): HTMLElement {
  const link = h('a', { href: routeHref(CHANGELOG), class: 'strv-footer__link' }, 'Changelog');
  void loadPublishedVersions().then((v) => {
    if (v !== null) link.textContent = line(v);
  });
  return h('footer', { class: 'strv-footer' }, link, h('a', { href: routeHref(PRIVACY), class: 'strv-footer__link' }, 'Privacy'), h('a', { href: routeHref(REMOVE), class: 'strv-footer__link' }, 'Remove'));
}
