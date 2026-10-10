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

  it('scrolls to the question without throwing where scrollIntoView does not exist', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })));
    // Run the frame callback at once, so a throw inside it surfaces here instead of as an unhandled error after the test.
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    expect(typeof Element.prototype.scrollIntoView).not.toBe('function');
    const { startRouter } = await import('../../src/client/app/router');
    const outlet = document.createElement('div');
    document.body.append(outlet);
    history.replaceState(null, '', '#/faq/ties');
    expect(() => startRouter(outlet)).not.toThrow();
    expect(outlet.querySelector('#strv-faq-ties')).not.toBeNull();
  });
});
