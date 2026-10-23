// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { PAGE_META } from '../../src/client/shared';
import { createHowPage } from '../../src/client/pages/how';
import { createFaqPage } from '../../src/client/pages/faq';
import { createChangelogPage } from '../../src/client/pages/changelog';

describe('PAGE_META', () => {
  it('keeps every title within 60 characters and description within 160, with no em dash', () => {
    for (const m of Object.values(PAGE_META)) {
      expect(m.title.length).toBeLessThanOrEqual(60);
      expect(m.description.length).toBeLessThanOrEqual(160);
      expect(`${m.title}${m.description}`).not.toContain('\u2014');
    }
  });

  it('sets document.title from it on the how, faq and changelog pages', () => {
    createHowPage({ page: 'how', section: null });
    expect(document.title).toBe(PAGE_META.how.title);
    createFaqPage({ page: 'faq', question: null });
    expect(document.title).toBe(PAGE_META.faq.title);
    createChangelogPage();
    expect(document.title).toBe(PAGE_META.changelog.title);
  });
});
