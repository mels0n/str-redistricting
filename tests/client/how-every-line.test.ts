// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { fanDiagram, rangesDiagram } from '../../src/client/pages/how/diagrams';
import { createHowPage } from '../../src/client/pages/how';

describe('How it works: every straight line', () => {
  it('draws the ranges strip with five stretches and an accessible description', () => {
    const svg = rangesDiagram();
    expect(svg.querySelectorAll('rect').length).toBe(5);
    expect(svg.querySelector('desc')?.textContent).toContain('one check covers the whole stretch');
  });

  it('does not claim a fixed number of directions', () => {
    expect(fanDiagram().textContent).not.toMatch(/1,800|0\.1/);
    expect(fanDiagram().querySelector('desc')?.textContent).toContain('every direction');
  });

  it('explains the exact search without the old grid, and uses no em dashes', () => {
    const page = createHowPage({ page: 'how', section: null } as never);
    const text = page.el.textContent ?? '';
    expect(text).toContain('every direction, with none skipped');
    expect(text).not.toMatch(/1,800|0\.1°|0\.1 degree|angle step/);
    expect(text).not.toContain('—');
    page.destroy();
  });

  it('says the side holding the lowest GEOID is numbered first, and balances in whole micrometers', () => {
    const page = createHowPage({ page: 'how', section: null } as never);
    const text = page.el.textContent ?? '';
    expect(text).toContain('The side holding the piece’s lowest GEOID gets the lower district numbers.');
    expect(text).toContain('measured in whole micrometers, from the same stored length for each pair of neighbors, so it is compared exactly');
    page.destroy();
  });
});
