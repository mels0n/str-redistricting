// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  history.replaceState(null, '', '#/');
});

describe('router: the FAQ', () => {
  it('opens the FAQ at a question, marks its masthead link, and clears the mark on leaving', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })));
    const { createSiteHeader } = await import('../../src/client/widgets/site-header');
    const { startRouter } = await import('../../src/client/app/router');
    const outlet = document.createElement('div');
    document.body.append(createSiteHeader(), outlet);
    history.replaceState(null, '', '#/faq/ties');
    startRouter(outlet);

    expect(outlet.querySelector('#strv-faq-ties')).not.toBeNull();
    const faq = document.querySelector('[data-nav="faq"]')!;
    expect(faq.getAttribute('aria-current')).toBe('page');
    expect(document.querySelector('[data-nav="how"]')?.hasAttribute('aria-current')).toBe(false);

    history.replaceState(null, '', '#/changelog');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(outlet.querySelector('#strv-faq-ties')).toBeNull();
    expect(faq.hasAttribute('aria-current')).toBe(false);
  });
});
