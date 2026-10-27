// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { PAGE_META } from '../../src/client/shared';
import { createHowPage } from '../../src/client/pages/how';
import { createFaqPage } from '../../src/client/pages/faq';
import { createChangelogPage } from '../../src/client/pages/changelog';
import { createPrivacyPage } from '../../src/client/pages/privacy';

describe('PAGE_META', () => {
  it('keeps every title within 60 characters and description within 160, with no em dash', () => {
    for (const m of Object.values(PAGE_META)) {
      expect(m.title.length).toBeLessThanOrEqual(60);
      expect(m.description.length).toBeLessThanOrEqual(160);
      expect(`${m.title}${m.description}`).not.toContain('\u2014');
    }
  });

  it('sets document.title from it on the how, faq, changelog and privacy pages', () => {
    createHowPage({ page: 'how', section: null });
    expect(document.title).toBe(PAGE_META.how.title);
    createFaqPage({ page: 'faq', question: null });
    expect(document.title).toBe(PAGE_META.faq.title);
    createChangelogPage();
    expect(document.title).toBe(PAGE_META.changelog.title);
    createPrivacyPage();
    expect(document.title).toBe(PAGE_META.privacy.title);
  });

  it('keeps the literal page titles', () => {
    createHowPage({ page: 'how', section: null });
    expect(document.title).toBe('How the districts are drawn | Fair Maps');
    createChangelogPage();
    expect(document.title).toBe('Changelog | Fair Maps');
  });

  it('titles the national page and links its three questions', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })));
    const { createNationalPage } = await import('../../src/client/pages/national');
    const page = createNationalPage(() => undefined);
    expect(document.title).toBe('Fair Maps: districts drawn by a rule');
    expect([...page.el.querySelectorAll('.strv-national__questions a')].map((a) => a.getAttribute('href'))).toEqual(['/faq/gerrymandering', '/faq/stop', '/faq/today']);
    page.destroy();
    vi.unstubAllGlobals();
  });
});
