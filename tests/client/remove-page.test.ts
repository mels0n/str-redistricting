// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

interface Widget {
  token: (t: string) => void;
  resets: number;
}
const widgets: Widget[] = [];
vi.mock('../../src/client/features/sign-on/turnstile', () => ({
  mountTurnstile: async (_el: HTMLElement, _key: string, handlers: { onToken: (t: string) => void }) => {
    const w: Widget = { token: handlers.onToken, resets: 0 };
    widgets.push(w);
    return { reset: () => void w.resets++, remove: () => {} };
  },
}));

import { PAGE_META, parsePath, formatPath, canonicalPath } from '../../src/client/shared';
import { createRemovePage, REMOVE_COPY } from '../../src/client/pages/remove';
import { createPrivacyPage } from '../../src/client/pages/privacy';
import { createSiteFooter } from '../../src/client/widgets/site-footer';
import { sitemapXml } from '../../build/seo';
import { pageHtml } from '../../build/prerender';

const TOKEN = 'ab'.repeat(32);
const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};
let fetchMock: ReturnType<typeof vi.fn>;
const reply = (status: number, body: unknown) => fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));

beforeEach(() => {
  widgets.length = 0;
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('remove page without a token', () => {
  it('shows the request form with the exact copy and posts the email and check token', async () => {
    const page = createRemovePage(null);
    document.body.append(page.el);
    await settle();
    expect(page.el.querySelector('h1')!.textContent).toBe('Remove your signature');
    expect(page.el.querySelector('.strv-how__lede')!.textContent).toBe(
      'Enter the email you signed with. We’ll send a link that removes your signature, your note and your email from Fair Maps for good.',
    );
    expect(page.el.querySelector('label')!.textContent).toBe('Email');
    const button = page.el.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    expect(button.textContent).toBe('Send removal link');
    page.el.querySelector<HTMLInputElement>('input[name="email"]')!.value = 'ada@example.com';
    widgets[0]!.token('tok');
    reply(202, { status: 'check-email' });
    page.el.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/remove-request');
    expect(JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string)).toEqual({ email: 'ada@example.com', turnstileToken: 'tok' });
    expect(page.el.querySelector('[role="status"]')!.textContent).toBe('If that email is signed up, a removal link is on its way. It works for 48 hours.');
  });
});

describe('remove page with a token', () => {
  it('does not call the API until the button is pressed, then shows the removed copy', async () => {
    const page = createRemovePage(TOKEN);
    document.body.append(page.el);
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(page.el.textContent).toContain('This permanently removes your signature, your note and your email. Your district’s count goes down by one.');
    const button = page.el.querySelector<HTMLButtonElement>('button')!;
    expect(button.textContent).toBe('Remove me');
    reply(200, { status: 'removed' });
    button.click();
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/remove');
    expect((fetchMock.mock.calls[0]![1] as RequestInit).method).toBe('POST');
    expect(JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string)).toEqual({ token: TOKEN });
    expect(page.el.querySelector('[role="status"]')!.textContent).toBe('You’ve been removed. Thanks for having been part of it.');
  });

  it('says so for a used link, and offers the request form above the message for an expired one', async () => {
    const used = createRemovePage(TOKEN);
    document.body.append(used.el);
    reply(400, { error: 'token-invalid' });
    used.el.querySelector<HTMLButtonElement>('button')!.click();
    await settle();
    expect(used.el.querySelector('[role="alert"]')!.textContent).toBe('This link was already used or isn’t valid.');

    const old = createRemovePage(TOKEN);
    document.body.append(old.el);
    reply(410, { error: 'token-expired' });
    old.el.querySelector<HTMLButtonElement>('button')!.click();
    await settle();
    expect([...old.el.querySelectorAll('[role="alert"]')].at(-1)!.textContent).toBe('This link has expired. Ask for a new one above.');
    expect(old.el.querySelector('form')).not.toBeNull();
  });
});

describe('routing and discovery', () => {
  it('reads only a well-formed token from the address, and keeps it out of the canonical path', () => {
    expect(parsePath('/remove', `?token=${TOKEN}`)).toEqual({ page: 'remove', token: TOKEN });
    expect(parsePath('/remove', '?token=zz')).toEqual({ page: 'remove', token: null });
    expect(formatPath({ page: 'remove', token: TOKEN })).toBe(`/remove?token=${TOKEN}`);
    expect(canonicalPath({ page: 'remove', token: TOKEN })).toBe('/remove');
  });

  it('is left out of the sitemap and the prerendered page says noindex', () => {
    expect(sitemapXml('https://x.test', [])).not.toContain('/remove');
    expect(sitemapXml('https://x.test', [])).toContain('/privacy');
    const shell = readFileSync('index.html', 'utf8');
    const html = pageHtml('remove', shell, { html: '<main></main>', faq: [] });
    expect(html).toContain('<meta name="robots" content="noindex">');
    expect(html).toContain('<title>Remove your signature | Fair Maps</title>');
    expect(pageHtml('privacy', shell, { html: '<main></main>', faq: [] })).not.toContain('noindex');
  });

  it('is linked from the privacy page, not the footer, and has no em dash', () => {
    expect([...createSiteFooter().querySelectorAll('a')].map((a) => a.getAttribute('href'))).not.toContain('/remove');
    const link = [...createPrivacyPage().el.querySelectorAll('a')].find((a) => a.getAttribute('href') === '/remove');
    expect(link?.textContent).toBe('Remove your signature');
    expect(JSON.stringify([PAGE_META.remove, REMOVE_COPY])).not.toContain('—');
  });
});
