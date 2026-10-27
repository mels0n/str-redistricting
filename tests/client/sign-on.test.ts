// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { z } from 'zod';

interface Widget {
  siteKey: string;
  token: (t: string) => void;
  clear: () => void;
  resets: number;
  removed: boolean;
}
const widgets: Widget[] = [];
let mountFails = false;
vi.mock('../../src/client/features/sign-on/turnstile', () => ({
  mountTurnstile: async (_el: HTMLElement, siteKey: string, handlers: { onToken: (t: string) => void; onClear: () => void }) => {
    if (mountFails) throw new Error('load failed');
    const w: Widget = { siteKey, token: handlers.onToken, clear: handlers.onClear, resets: 0, removed: false };
    widgets.push(w);
    return { reset: () => void w.resets++, remove: () => void (w.removed = true) };
  },
}));

import { config } from '../../src/client/shared';
import { createSignOnForm, signPayload, SIGN_ERROR_COPY, SIGN_FALLBACK_COPY, SENT_COPY, QUEUED_COPY } from '../../src/client/features/sign-on';
import { createPrivacyPage } from '../../src/client/pages/privacy';
import { createSiteFooter } from '../../src/client/widgets/site-footer';

/** Cloudflare's published always-passes test site key. */
const TEST_SITE_KEY = '1x00000000000000000000AA';

// The server's request schema, restated here (client and server never import each other).
const ServerSign = z.strictObject({
  address: z.string().min(4).max(200),
  email: z.email().max(254),
  turnstileToken: z.string().min(1).max(2048),
  consentUpdates: z.boolean(),
  showPublic: z.boolean(),
  displayName: z.string().max(40).nullable(),
  ref: z.string().nullable(),
});

const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};
const q = <T extends Element>(root: Element, sel: string): T => root.querySelector<T>(sel)!;
const byName = (root: Element, name: string): HTMLInputElement => q<HTMLInputElement>(root, `[name="${name}"]`);

let fetchMock: ReturnType<typeof vi.fn>;
let savedKey: string;
beforeEach(() => {
  widgets.length = 0;
  mountFails = false;
  savedKey = config.turnstileSiteKey;
  config.turnstileSiteKey = TEST_SITE_KEY;
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  config.turnstileSiteKey = savedKey;
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

function fill(el: HTMLElement): void {
  byName(el, 'email').value = 'maria@example.org';
  byName(el, 'displayName').value = 'Maria G.';
  byName(el, 'showPublic').checked = true;
  byName(el, 'consentUpdates').checked = true;
  byName(el, 'address').value = '10 Elm St, Denver CO';
}
const submit = async (el: HTMLElement): Promise<void> => {
  q<HTMLFormElement>(el, 'form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  await settle();
};

describe('sign-on form', () => {
  it('has the exact copy, prefills the address and renders the widget with the configured key', async () => {
    const f = createSignOnForm({ address: '1 Main St, Denver, CO' });
    document.body.append(f.el);
    await settle();
    expect(q(f.el, 'h4').textContent).toBe('Add your name');
    expect(q(f.el, '.strv-sign__lede').textContent).toBe(
      'Sign to support the Fair Maps rule. You’ll be counted in your district once you confirm your email. We don’t keep your address.',
    );
    expect([...f.el.querySelectorAll('label')].map((l) => l.textContent)).toEqual([
      'Address',
      'Email',
      'Name to show (optional)',
      'Show my name and town on the site',
      'Email me updates about Fair Maps',
    ]);
    expect(q(f.el, '.strv-sign__hint').textContent).toBe('First name and last initial, like Maria G.');
    expect(byName(f.el, 'address').value).toBe('1 Main St, Denver, CO');
    expect(q(f.el, 'button[type="submit"]').textContent).toBe('Sign');
    expect(q<HTMLAnchorElement>(f.el, 'a').getAttribute('href')).toBe('/privacy');
    expect(widgets.map((w) => w.siteKey)).toEqual([TEST_SITE_KEY]);
    expect(f.el.textContent).not.toContain('2014');
  });

  it('posts exactly the server schema shape to /api/sign', async () => {
    fetchMock.mockResolvedValue(Response.json({ status: 'check-email', queued: false }, { status: 202 }));
    const f = createSignOnForm({ address: '' });
    await settle();
    fill(f.el);
    widgets[0]!.token('tok-1');
    await submit(f.el);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/sign');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string) as unknown;
    expect(ServerSign.safeParse(body).success).toBe(true);
    expect(body).toEqual({
      address: '10 Elm St, Denver CO',
      email: 'maria@example.org',
      turnstileToken: 'tok-1',
      consentUpdates: true,
      showPublic: true,
      displayName: 'Maria G.',
      ref: null,
    });
  });

  it('sends a null display name when the field is empty', () => {
    expect(signPayload({ address: ' a b c d ', email: 'x@y.co', displayName: '  ', showPublic: false, consentUpdates: false, turnstileToken: 't' })).toMatchObject({ address: 'a b c d', displayName: null });
  });

  it('shows the confirm message after a 202 that was sent now, and the in-line message when queued', async () => {
    fetchMock.mockResolvedValue(Response.json({ status: 'check-email', queued: false }, { status: 202 }));
    const a = createSignOnForm({ address: '' });
    await settle();
    fill(a.el);
    widgets[0]!.token('t');
    await submit(a.el);
    expect(a.el.textContent).toBe('Check your email to confirm. The link works for 48 hours.');
    expect(SENT_COPY).toBe('Check your email to confirm. The link works for 48 hours.');

    fetchMock.mockResolvedValue(Response.json({ status: 'check-email', queued: true }, { status: 202 }));
    const b = createSignOnForm({ address: '' });
    await settle();
    fill(b.el);
    widgets[1]!.token('t');
    await submit(b.el);
    expect(b.el.textContent).toBe(QUEUED_COPY);
    expect(QUEUED_COPY).toBe(
      'You’re in line. Because so many people are signing, confirmation emails go out in order, and yours should arrive within a day or two. The link works for 48 hours from when it arrives.',
    );
  });

  it.each([
    [422, 'address-not-found', 'We couldn’t find that address. Check it and try again.'],
    [422, 'outside-states', 'Signing is open to addresses in the 50 states.'],
    [429, 'rate-limit', 'Too many tries from here. Try again in an hour.'],
    [403, 'bot-check', 'The check didn’t go through. Try again.'],
    [503, 'unavailable', 'Couldn’t sign you up just now. Try again in a minute.'],
    [400, 'bad-request', 'Couldn’t sign you up just now. Try again in a minute.'],
  ])('maps %i %s to its message and keeps what was typed', async (status, code, message) => {
    fetchMock.mockResolvedValue(Response.json({ error: code }, { status }));
    const f = createSignOnForm({ address: '' });
    await settle();
    fill(f.el);
    widgets[0]!.token('t');
    await submit(f.el);
    const err = q<HTMLElement>(f.el, '.strv-sign__error');
    expect(err.hidden).toBe(false);
    expect(err.textContent).toBe(message);
    expect(byName(f.el, 'email').value).toBe('maria@example.org');
    expect(byName(f.el, 'displayName').value).toBe('Maria G.');
    expect(byName(f.el, 'address').value).toBe('10 Elm St, Denver CO');
    expect(byName(f.el, 'showPublic').checked).toBe(true);
    expect(byName(f.el, 'consentUpdates').checked).toBe(true);
    // The single-use token is dropped and a new check is asked for.
    expect(widgets[0]!.resets).toBe(1);
    expect(q<HTMLButtonElement>(f.el, 'button[type="submit"]').disabled).toBe(false);
  });

  it('treats a network failure as the generic error, and sends nothing without a check token', async () => {
    const f = createSignOnForm({ address: '' });
    await settle();
    fill(f.el);
    await submit(f.el);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(q(f.el, '.strv-sign__error').textContent).toBe(SIGN_ERROR_COPY['bot-check']);
    fetchMock.mockRejectedValue(new TypeError('offline'));
    widgets[0]!.token('t');
    await submit(f.el);
    expect(q(f.el, '.strv-sign__error').textContent).toBe(SIGN_FALLBACK_COPY);
    expect(byName(f.el, 'email').value).toBe('maria@example.org');
  });

  it('says so when the bot check cannot load', async () => {
    mountFails = true;
    const f = createSignOnForm({ address: '' });
    await settle();
    expect(q(f.el, '.strv-sign__error').textContent).toBe(SIGN_FALLBACK_COPY);
  });

  it('removes the widget when destroyed', async () => {
    const f = createSignOnForm({ address: '' });
    await settle();
    f.destroy();
    expect(widgets[0]!.removed).toBe(true);
  });
});

describe('privacy page and footer', () => {
  it('has the plain sections, links /remove, and uses no em dash', () => {
    const page = createPrivacyPage();
    expect([...page.el.querySelectorAll('h2')].map((e) => e.textContent)).toEqual([
      'What we collect',
      'What we never keep',
      'What is public',
      'What goes to your representative',
      'Who sees your email',
      'How to be removed',
      'Services we use',
    ]);
    expect(page.el.querySelector('a[href="/remove"]')).not.toBeNull();
    expect(page.el.textContent).toContain('Supabase');
    expect(page.el.textContent).toContain('Cloudflare Turnstile');
    expect(page.el.textContent).not.toContain('2014');
    expect(page.el.textContent!.toLowerCase()).not.toMatch(/draft|voter/);
  });

  it('links the footer to /privacy', () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })));
    const hrefs = [...createSiteFooter().querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/privacy');
  });

  it('has no em dash in the feature sources', () => {
    for (const f of ['src/client/features/sign-on/ui.ts', 'src/client/features/sign-on/turnstile.ts', 'src/client/pages/privacy/ui.ts']) {
      expect(readFileSync(f, 'utf8')).not.toContain('2014');
    }
  });
});
