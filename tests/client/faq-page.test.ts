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
    expect([...page.el.querySelectorAll('.strv-how__toc a')].map((a) => a.getAttribute('href'))).toEqual(FAQ_QUESTIONS.map((q) => `#/faq/${q}`));
    expect(document.title).toBe('FAQ | Fair Maps');
  });

  it('carries the strange-shape answer and the tiebreaks', () => {
    const page = createFaqPage({ page: 'faq', question: null });
    const strange = page.el.querySelector('#strv-faq-strange')!;
    expect(strange.querySelector('h2')?.textContent).toContain('Why does my district look strange?');
    expect(strange.querySelector('a[href="#/CO/cut/1"]')?.textContent).toBe('starting with Colorado’s first cut');
    expect(strange.textContent).toContain('Nobody chose any single line.');
    const ties = page.el.querySelector('#strv-faq-ties')!;
    expect(ties.textContent).toContain('nearer their fair shares of people');
    expect(ties.textContent).toContain('GEOID order');
    expect(ties.querySelector('a[href="#/how/balancing"]')).not.toBeNull();
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
