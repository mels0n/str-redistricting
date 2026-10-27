// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { FAQ_QUESTIONS, faqRoute } from '../../src/client/shared';
import { createFaqPage } from '../../src/client/pages/faq';

describe('FAQ page', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('answers every question in order, each listed in the contents', () => {
    const page = createFaqPage({ page: 'faq', question: null });
    const ids = [...page.el.querySelectorAll('section.strv-how__section')].map((s) => s.id);
    expect(ids).toEqual(FAQ_QUESTIONS.map((q) => `strv-faq-${q}`));
    expect([...page.el.querySelectorAll('.strv-how__toc a')].map((a) => a.getAttribute('href'))).toEqual(FAQ_QUESTIONS.map((q) => `/faq/${q}`));
    expect(document.title).toBe('FAQ | Fair Maps');
  });

  it('opens with the three gerrymandering questions', () => {
    const page = createFaqPage({ page: 'faq', question: null });
    const sections = [...page.el.querySelectorAll('section.strv-how__section')];
    expect(sections).toHaveLength(16);
    const titles = sections.slice(0, 3).map((s) => {
      const h2 = s.querySelector('h2')!.cloneNode(true) as HTMLElement;
      h2.querySelector('.strv-how__no')?.remove();
      return h2.textContent;
    });
    expect(titles).toEqual(['What is gerrymandering?', 'How do you stop gerrymandering?', 'How are districts drawn today?']);
    expect(sections[0]!.textContent).toContain('pack one side’s voters');
    expect(sections[1]!.querySelector('a[href="/how"]')?.textContent).toBe('How it works');
  });

  it('explains why state rules are not followed, with no em dash', () => {
    const page = createFaqPage({ page: 'faq', question: null });
    const q = page.el.querySelector('#strv-faq-state-laws')!;
    expect(q.querySelector('h2')?.textContent).toContain('redistricting laws');
    expect(q.textContent).toContain('the number of districts');
    expect(page.el.textContent).not.toContain('\u2014');
  });

  it('carries the strange-shape answer and the tiebreaks', () => {
    const page = createFaqPage({ page: 'faq', question: null });
    const strange = page.el.querySelector('#strv-faq-strange')!;
    expect(strange.querySelector('h2')?.textContent).toContain('Why does my district look strange?');
    expect(strange.querySelector('a[href="/CO/cut/1"]')?.textContent).toBe('starting with Colorado’s first cut');
    expect(strange.textContent).toContain('Nobody chose any single line.');
    const ties = page.el.querySelector('#strv-faq-ties')!;
    expect(ties.textContent).toContain('nearer their fair shares of people');
    expect(ties.textContent).toContain('GEOID order');
    // Balancing ties go to the shorter border, then GEOID order; no district number settles one.
    expect(ties.textContent).toContain('shorter total border');
    expect(ties.textContent).not.toMatch(/lower[- ]?(district )?number|lower-numbered/i);
    // The cut rules as the generator applies them, and none of the direction preferences it does not have.
    expect(ties.textContent).toContain('both stopping points are kept as candidates');
    expect(ties.textContent).toContain('the lower GEOID');
    expect(ties.textContent).not.toMatch(/north-south|smaller angle|most blocks/);
    expect(ties.querySelector('a[href="/how/balancing"]')).not.toBeNull();
  });

  it('explains the jargon: census blocks first, then a glossary', () => {
    const page = createFaqPage({ page: 'faq', question: null });
    expect(page.el.querySelector('#strv-faq-block')?.textContent).toContain('smallest area the U.S. Census Bureau counts people in');
    const terms = [...page.el.querySelectorAll('#strv-faq-terms dt')].map((t) => t.textContent);
    for (const t of ['Census block', 'GEOID', 'Internal point', 'Guide line', 'Stray piece', 'Island link', 'Ideal population', 'Fingerprint']) expect(terms).toContain(t);
  });

  it('has no em dash in its copy', () => {
    expect(createFaqPage({ page: 'faq', question: null }).el.textContent).not.toContain('—');
  });

  it('marks the question asked for and keeps the page for another question', () => {
    const page = createFaqPage({ page: 'faq', question: 'ties' });
    expect(page.el.querySelector('a[data-question="ties"]')?.getAttribute('aria-current')).toBe('location');
    expect(page.focusTarget()?.id).toBe('strv-faq-ties-h');
    expect(page.update?.(faqRoute('water'))).toBe(true);
    expect(page.el.querySelector('a[data-question="water"]')?.getAttribute('aria-current')).toBe('location');
    expect(page.el.querySelector('a[data-question="ties"]')?.hasAttribute('aria-current')).toBe(false);
    expect(page.update?.({ page: 'how', section: null })).toBe(false);
  });
});

describe('legislative vintage in the copy', () => {
  it('names the vintage from config/enacted.json on the FAQ and How pages', async () => {
    const { ENACTED } = await import('../../src/client/shared');
    const { default: enactedJson } = await import('../../config/enacted.json');
    expect(ENACTED.legislativeVintage).toBe(enactedJson.legislative.vintage);
    const v = String(ENACTED.legislativeVintage);
    const faq = createFaqPage({ page: 'faq', question: null }).el.textContent ?? '';
    expect(faq).toContain(`Census Bureau’s ${v} state legislative district files`);
    expect(faq).toContain(`distinct district in the Census Bureau’s ${v} state legislative district files`);
    const { createHowPage } = await import('../../src/client/pages/how');
    const how = createHowPage({ page: 'how', section: null }).el.textContent ?? '';
    expect(how).toContain(`state legislative districts (${v}), cb_${v}_<fips>_sldl_500k and cb_${v}_<fips>_sldu_500k`);
    expect(how).toContain(`Census Bureau’s ${v} state legislative district file for that chamber`);
  });
});
