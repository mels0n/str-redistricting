import { h, formatHash, censusLabel, CHANGELOG, VERSIONS } from '../../shared';

/** One line naming the versions behind every map on the site, linking to what changed in each. */
export function createSiteFooter(): HTMLElement {
  const { maps, engine, input, web } = VERSIONS;
  return h(
    'footer',
    { class: 'strv-footer' },
    h('a', { href: formatHash(CHANGELOG), class: 'strv-footer__link' }, `Maps release ${maps} · Engine ${engine} · ${censusLabel(input.vintage)} (r${input.revision}) · Site ${web}`),
  );
}
