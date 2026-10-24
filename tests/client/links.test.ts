// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { createFaqPage } from '../../src/client/pages/faq';
import { createHowPage } from '../../src/client/pages/how';
import { createSiteHeader } from '../../src/client/widgets/site-header';

const hrefs = (el: HTMLElement): string[] => [...el.querySelectorAll('a[href]')].map((a) => a.getAttribute('href') ?? '');

describe('links use path routes', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('the FAQ page has no hash links', () => {
    const list = hrefs(createFaqPage({ page: 'faq', question: null }).el);
    expect(list.length).toBeGreaterThan(0);
    expect(list.filter((href) => href.startsWith('#/'))).toEqual([]);
  });

  it('the How it works page has no hash links', () => {
    const list = hrefs(createHowPage({ page: 'how', section: null }).el);
    expect(list.length).toBeGreaterThan(0);
    expect(list.filter((href) => href.startsWith('#/'))).toEqual([]);
  });

  it('the site header has no hash links', () => {
    const list = hrefs(createSiteHeader());
    expect(list.length).toBeGreaterThan(0);
    expect(list.filter((href) => href.startsWith('#/'))).toEqual([]);
  });
});
