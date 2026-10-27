// @vitest-environment jsdom
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { config, feedbackHref, type FeedbackKind } from '../../src/client/shared';

const kinds: FeedbackKind[] = ['question', 'problem'];
const forms = ['config', ...kinds].map((f) => `.github/ISSUE_TEMPLATE/${f}.yml`);

describe('issue forms', () => {
  it('has a form for every kind of report the site links to', () => {
    for (const kind of kinds) {
      expect(existsSync(`.github/ISSUE_TEMPLATE/${kind}.yml`), kind).toBe(true);
      expect(feedbackHref(kind)).toBe(`${config.repoUrl}/issues/new?template=${kind}.yml`);
    }
  });

  it('links only to the site and the repository', () => {
    for (const form of forms) {
      for (const [url] of readFileSync(form, 'utf8').matchAll(/https?:\/\/[^\s)"']+/g)) {
        expect([config.siteHost, 'github.com'], `${form}: ${url}`).toContain(new URL(url).host);
      }
    }
  });

  it('warns that problem reports are public before asking about the address search', () => {
    const text = readFileSync('.github/ISSUE_TEMPLATE/problem.yml', 'utf8');
    expect(text).toMatch(/Issues here are public/);
    expect(text).toMatch(/not your home address/);
    expect(text).not.toContain('—');
  });

  it('is offered from the FAQ', async () => {
    const { createFaqPage } = await import('../../src/client/pages/faq');
    const faq = createFaqPage({ page: 'faq', question: null });
    expect([...faq.el.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toContain(feedbackHref('question'));
    faq.destroy();
  });
});
