// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createSiteFooter } from '../../src/client/widgets/site-footer';
import { VERSIONS, censusLabel } from '../../src/client/shared';

describe('site footer', () => {
  it('names the release, engine, Census input and site version, linking to the changelog', () => {
    const el = createSiteFooter();
    const expected = `Maps release ${VERSIONS.maps} · Engine ${VERSIONS.engine} · ${censusLabel(VERSIONS.input.vintage)} (r${VERSIONS.input.revision}) · Site ${VERSIONS.web}`;
    expect(el.textContent).toBe(expected);
    const links = el.querySelectorAll('a');
    expect(links).toHaveLength(1);
    expect(links[0]!.getAttribute('href')).toBe('#/changelog');
    expect(links[0]!.textContent).toBe(expected);
    expect(expected).not.toContain('—');
  });
});
