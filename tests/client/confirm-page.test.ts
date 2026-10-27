// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { canonicalPath, formatPath, PAGE_META, parsePath } from '../../src/client/shared';
import { sitemapXml } from '../../build/seo';
import { pageHtml } from '../../build/prerender';

const TOKEN = 'ab'.repeat(32);
const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};
let fetchMock: ReturnType<typeof vi.fn>;
const reply = (status: number, body: unknown) => fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));

async function load() {
  // Each test starts with a fresh page module, so the one-request-per-token memory is empty.
  vi.resetModules();
  return (await import('../../src/client/pages/confirm')).createConfirmPage;
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('confirm page', () => {
  it('posts the token by itself on load, exactly once, and shows the signed copy with a way back', async () => {
    const createConfirmPage = await load();
    reply(200, { status: 'confirmed', state: 'CO' });
    const page = createConfirmPage(TOKEN);
    document.body.append(page.el);
    expect(page.el.querySelector('h1')!.textContent).toBe('Confirming your signature');
    expect(page.el.textContent).toContain('Confirming your signature...');
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/confirm');
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ token: TOKEN });
    expect(page.el.querySelector('[role="status"]')!.textContent).toBe('You’re signed. Thanks for adding your name.');
    const back = page.el.querySelector('a')!;
    expect(back.textContent).toBe('Back to the maps');
    expect(back.getAttribute('href')).toBe('/CO?signed=1');
    expect(page.el.querySelector('button')).toBeNull();
  });

  it('does not ask again when the same link is opened a second time in the same script', async () => {
    const createConfirmPage = await load();
    reply(200, { status: 'confirmed', state: 'CO' });
    const a = createConfirmPage(TOKEN);
    const b = createConfirmPage(TOKEN);
    document.body.append(a.el, b.el);
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a.el.textContent).toContain('You’re signed.');
    expect(b.el.textContent).toContain('You’re signed.');
  });

  it.each([
    [410, { error: 'token-expired' }, 'That link has expired. Sign again to get a new one.'],
    [400, { error: 'token-invalid' }, 'That link was already used or isn’t valid.'],
    [503, { error: 'unavailable' }, 'That didn’t go through just now. Try again in a minute.'],
  ])('shows the notice for %i', async (status, body, text) => {
    const createConfirmPage = await load();
    reply(status, body);
    const page = createConfirmPage(TOKEN);
    document.body.append(page.el);
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(page.el.querySelector('[role="alert"]')!.textContent).toBe(text);
    expect(page.el.querySelector('a')!.textContent).toBe('Back to the maps');
  });

  it('shows the invalid notice and asks nothing when the address has no usable token', async () => {
    const createConfirmPage = await load();
    const page = createConfirmPage(null);
    document.body.append(page.el);
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(page.el.querySelector('[role="alert"]')!.textContent).toBe('That link was already used or isn’t valid.');
  });

  it('shows the network failure notice when the request cannot be made', async () => {
    const createConfirmPage = await load();
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    const page = createConfirmPage(TOKEN);
    document.body.append(page.el);
    await settle();
    expect(page.el.querySelector('[role="alert"]')!.textContent).toContain('Try again in a minute.');
  });

  it('the static copy never asks, and carries only the no-JavaScript line', async () => {
    const createConfirmPage = await load();
    const page = createConfirmPage(null, 'static');
    document.body.append(page.el);
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(page.el.querySelector('noscript')!.textContent).toBe('Turn on JavaScript to confirm your signature.');
    expect(page.el.querySelector('[role="alert"]')).toBeNull();
  });
});

describe('routing and discovery', () => {
  it('reads only a well-formed token, and keeps it out of the canonical path', () => {
    expect(parsePath('/confirm', `?token=${TOKEN}`)).toEqual({ page: 'confirm', token: TOKEN });
    expect(parsePath('/confirm', '?token=zz')).toEqual({ page: 'confirm', token: null });
    expect(formatPath({ page: 'confirm', token: TOKEN })).toBe(`/confirm?token=${TOKEN}`);
    expect(canonicalPath({ page: 'confirm', token: TOKEN })).toBe('/confirm');
  });

  it('is left out of the sitemap, says noindex, and its prerendered HTML contains nothing that confirms anyone', async () => {
    expect(sitemapXml('https://x.test', [])).not.toContain('/confirm');
    const shell = readFileSync('index.html', 'utf8');
    const createConfirmPage = await load();
    const html = pageHtml('confirm', shell, { html: createConfirmPage(null, 'static').el.outerHTML, faq: [] });
    expect(html).toContain('<meta name="robots" content="noindex">');
    expect(html).toContain('<title>Confirm your signature | Fair Maps</title>');
    expect(html).toContain('<noscript>Turn on JavaScript to confirm your signature.</noscript>');
    expect(html).not.toContain('/api/confirm');
    expect(html).not.toContain('token=');
    expect(JSON.stringify(PAGE_META.confirm)).not.toContain('—');
  });
});
