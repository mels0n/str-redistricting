import { h, formatHash, censusLabel, CHANGELOG, VERSIONS, loadPublishedVersions, type Versions } from '../../shared';

const line = (v: Versions): string => `Maps release ${v.maps} · Engine ${v.engine} · ${censusLabel(v.input.vintage)} (r${v.input.revision}) · Site ${VERSIONS.web}`;

/**
 * A link to what changed in each release. It names the versions behind the maps only once the published data says
 * what they are (public/data/versions.json); until then it claims nothing. The site's own version is the code's.
 */
export function createSiteFooter(): HTMLElement {
  const link = h('a', { href: formatHash(CHANGELOG), class: 'strv-footer__link' }, 'Changelog');
  void loadPublishedVersions().then((v) => {
    if (v !== null) link.textContent = line(v);
  });
  return h('footer', { class: 'strv-footer' }, link);
}
