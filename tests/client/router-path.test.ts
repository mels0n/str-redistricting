// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setRouteMode } from '../../src/client/shared/lib/route';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })));
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
  setRouteMode('path');
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  document.head.querySelectorAll('link[rel="canonical"], meta[property="og:url"]').forEach((el) => el.remove());
  setRouteMode('path');
  history.replaceState(null, '', '/');
});

async function start(url: string) {
  const { createSiteHeader } = await import('../../src/client/widgets/site-header');
  const { startRouter } = await import('../../src/client/app/router');
  const outlet = document.createElement('div');
  document.body.append(createSiteHeader(), outlet);
  history.replaceState(null, '', url);
  startRouter(outlet);
  return outlet;
}

const here = (): string => location.pathname + location.search;
const canonical = (): string | null => document.head.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? null;

function clickEvent(init: MouseEventInit = {}): MouseEvent {
  return new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init });
}

describe('router: path mode', () => {
  it.each([
    ['/#/CO/d/3?plan=before', '/CO/d/3?plan=before'],
    ['/#/how/strange', '/faq/strange'],
    ['/#/co', '/CO'],
    ['/co', '/CO'],
    ['/CO/d/3?plan=official', '/CO/d/3'],
  ])('lands %s on the canonical %s', async (from, to) => {
    await start(from);
    expect(here()).toBe(to);
    expect(location.hash).toBe('');
  });

  it('shows the page an old hash link names', async () => {
    const outlet = await start('/#/faq/ties');
    expect(outlet.querySelector('#strv-faq-ties')).not.toBeNull();
  });

  it('follows a click on an internal link without a page load, and sets the canonical address', async () => {
    const outlet = await start('/');
    const link = document.querySelector<HTMLAnchorElement>('a[href="/how"]')!;
    const ev = clickEvent();
    link.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(location.pathname).toBe('/how');
    expect(canonical()).toBe('https://fairmaps.melson.us/how');
    expect(document.head.querySelector('meta[property="og:url"]')?.getAttribute('content')).toBe('https://fairmaps.melson.us/how');
    expect(outlet.querySelector('h1')).not.toBeNull();
  });

  it('follows a click on an SVG link, and leaves a modified click to the browser', async () => {
    await start('/');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const a = document.createElementNS('http://www.w3.org/2000/svg', 'a');
    a.setAttribute('href', '/CO');
    svg.append(a);
    document.body.append(svg);
    const modified = clickEvent({ ctrlKey: true });
    a.dispatchEvent(modified);
    expect(modified.defaultPrevented).toBe(false);
    expect(location.pathname).toBe('/');
    const ev = clickEvent();
    a.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(location.pathname).toBe('/CO');
  });

  it('sets the canonical address on the first page too', async () => {
    await start('/CO/d/3?plan=before');
    expect(canonical()).toBe('https://fairmaps.melson.us/CO');
  });

  it('shows the previous page on back', async () => {
    const outlet = await start('/faq/ties');
    expect(outlet.querySelector('#strv-faq-ties')).not.toBeNull();
    document.querySelector<HTMLAnchorElement>('a[href="/how"]')!.dispatchEvent(clickEvent());
    expect(location.pathname).toBe('/how');
    expect(outlet.querySelector('#strv-faq-ties')).toBeNull();
    const popped = new Promise<void>((resolve) => window.addEventListener('popstate', () => resolve(), { once: true }));
    history.back();
    await popped;
    expect(location.pathname).toBe('/faq/ties');
    expect(outlet.querySelector('#strv-faq-ties')).not.toBeNull();
    expect(canonical()).toBe('https://fairmaps.melson.us/faq');
  });

  describe('clicks it leaves to the browser', () => {
    const cases: [string, string, MouseEventInit, Record<string, string>][] = [
      ['Ctrl click', '/how', { ctrlKey: true }, {}],
      ['Meta click', '/how', { metaKey: true }, {}],
      ['Shift click', '/how', { shiftKey: true }, {}],
      ['Alt click', '/how', { altKey: true }, {}],
      ['middle click', '/how', { button: 1 }, {}],
      ['target link', '/how', {}, { target: '_blank' }],
      ['download link', '/how', {}, { download: '' }],
      ['other origin', 'https://example.com/x', {}, {}],
      ['data file', '/data/index.json', {}, {}],
      ['asset', '/assets/app.js', {}, {}],
      ['file extension', '/CO/map.png', {}, {}],
    ];
    it.each(cases)('%s', async (_name, href, init, attrs) => {
      await start('/');
      const a = document.createElement('a');
      a.setAttribute('href', href);
      for (const [k, v] of Object.entries(attrs)) a.setAttribute(k, v);
      document.body.append(a);
      const ev = clickEvent(init);
      a.dispatchEvent(ev);
      expect(ev.defaultPrevented).toBe(false);
      expect(location.pathname).toBe('/');
    });

    it('a click another handler already handled', async () => {
      await start('/');
      const a = document.createElement('a');
      a.setAttribute('href', '/how');
      a.addEventListener('click', (e) => e.preventDefault());
      document.body.append(a);
      a.dispatchEvent(clickEvent());
      expect(location.pathname).toBe('/');
    });
  });

  it('keeps a fragment-only link on the page (the base href would otherwise send it to the home page)', async () => {
    await start('/faq/ties');
    const a = document.createElement('a');
    a.setAttribute('href', '#strv-main');
    document.body.append(a);
    const ev = clickEvent();
    a.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(here()).toBe('/faq/ties');
  });

  it('takes over an old hash link clicked inside the page', async () => {
    await start('/');
    const a = document.createElement('a');
    a.setAttribute('href', '#/how/strange');
    document.body.append(a);
    const ev = clickEvent();
    a.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(here()).toBe('/faq/strange');
  });
});

describe('router: hash mode (embedded)', () => {
  it('writes hash links, listens to hashchange, leaves clicks and the canonical tag alone', async () => {
    setRouteMode('hash');
    const outlet = await start('/#/');
    expect(document.querySelector('[data-nav="faq"]')?.getAttribute('href')).toBe('#/faq');
    expect(canonical()).toBeNull();

    history.replaceState(null, '', '/#/how');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(outlet.querySelector('h1')?.textContent).toMatch(/how/i);
    expect(canonical()).toBeNull();
    expect(location.pathname).toBe('/');

    const a = document.createElement('a');
    a.setAttribute('href', '/how');
    document.body.append(a);
    const ev = clickEvent();
    a.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
  });
});
