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
import { createSignOnForm, signPayload, SIGN_FALLBACK_COPY, SENT_COPY, QUEUED_COPY, WAIT_COPY, ADDRESS_HINT } from '../../src/client/features/sign-on';
import { createPrivacyPage } from '../../src/client/pages/privacy';
import { createSiteFooter } from '../../src/client/widgets/site-footer';

/** Cloudflare's published always-passes test site key. */
const TEST_SITE_KEY = '1x00000000000000000000AA';

// The server's request schema, restated here (client and server never import each other).
const ServerSign = z.strictObject({
  address: z.string().min(4).max(200).nullable(),
  state: z.string().regex(/^[A-Z]{2}$/).nullish(),
  email: z.email().max(254),
  turnstileToken: z.string().min(1).max(2048),
  consentUpdates: z.boolean(),
  showPublic: z.boolean(),
  displayName: z.string().max(40).nullable(),
  ref: z.string().nullable(),
  note: z.string().max(2000).nullable(),
}).refine((v) => v.address !== null || (v.state !== null && v.state !== undefined));

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
  byName(el, 'note').value = ' Fair lines matter ';
  byName(el, 'address').value = '10 Elm St, Denver CO';
  q<HTMLSelectElement>(el, '[name="state"]').value = 'CO';
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
      'Sign to support the Fair Maps rule. You’ll be counted once you confirm your email. Add an address to be counted in your district. We never keep your address.',
    );
    expect([...f.el.querySelectorAll('label')].map((l) => l.textContent)).toEqual([
      'Email',
      'State',
      'Name to show (optional)',
      'Address (optional)',
      'Why you signed (optional)',
      'Show my name and town on the site',
      'Email me updates about Fair Maps',
    ]);
    expect(q(f.el, '.strv-sign__hint').textContent).toBe('First name and last initial, like Maria G.');
    expect(byName(f.el, 'address').value).toBe('1 Main St, Denver, CO');
    expect(byName(f.el, 'address').required).toBe(false);
    expect(q<HTMLSelectElement>(f.el, '[name="state"]').required).toBe(true);
    expect(q<HTMLSelectElement>(f.el, '[name="state"]').options).toHaveLength(51);
    expect(f.el.querySelectorAll('.strv-sign__hint')[1]!.textContent).toBe(ADDRESS_HINT);
    expect(q(f.el, 'button[type="submit"]').textContent).toBe('Sign');
    expect(q<HTMLAnchorElement>(f.el, 'a').getAttribute('href')).toBe('/privacy');
    expect(widgets.map((w) => w.siteKey)).toEqual([TEST_SITE_KEY]);
    expect(f.el.textContent).not.toContain('2014');
  });

  it('keeps a live region for errors, focuses the first field on open and the message on success', async () => {
    fetchMock.mockResolvedValue(Response.json({ status: 'check-email', queued: false }, { status: 202 }));
    const f = createSignOnForm({ address: '' });
    document.body.append(f.el);
    await settle();
    const err = q<HTMLElement>(f.el, '.strv-sign__error');
    expect(err.getAttribute('role')).toBe('alert');
    expect(err.hidden).toBe(false);
    expect(err.textContent).toBe('');
    expect(document.activeElement).toBe(byName(f.el, 'email'));
    fill(f.el);
    widgets[0]!.token('t');
    await submit(f.el);
    const done = q<HTMLElement>(f.el, '.strv-sign__done');
    expect(done.getAttribute('tabindex')).toBe('-1');
    expect(document.activeElement).toBe(done);
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
      state: 'CO',
      email: 'maria@example.org',
      turnstileToken: 'tok-1',
      consentUpdates: true,
      showPublic: true,
      displayName: 'Maria G.',
      ref: null,
      note: 'Fair lines matter',
    });
  });

  it('signs with just a state: address null, state sent, and the same schema accepts it', async () => {
    fetchMock.mockResolvedValue(Response.json({ status: 'check-email', queued: false }, { status: 202 }));
    const f = createSignOnForm({ address: '', state: 'CO' });
    await settle();
    byName(f.el, 'email').value = 'maria@example.org';
    expect(q<HTMLSelectElement>(f.el, '[name="state"]').value).toBe('CO');
    widgets[0]!.token('tok-2');
    await submit(f.el);
    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string) as Record<string, unknown>;
    expect(ServerSign.safeParse(body).success).toBe(true);
    expect(body).toMatchObject({ address: null, state: 'CO', displayName: null, note: null });
  });

  it('takes a located address and state from the page', async () => {
    const f = createSignOnForm({ address: '', focus: false });
    await settle();
    f.setLocation({ address: '1 Main St', state: 'CO' });
    expect(byName(f.el, 'address').value).toBe('1 Main St');
    expect(q<HTMLSelectElement>(f.el, '[name="state"]').value).toBe('CO');
    expect(document.activeElement).not.toBe(byName(f.el, 'email'));
  });

  it('sends a null display name when the field is empty', () => {
    expect(signPayload({ state: 'CO', address: ' a b c d ', email: 'x@y.co', displayName: '  ', showPublic: false, consentUpdates: false, note: '  ', turnstileToken: 't' })).toMatchObject({ address: 'a b c d', displayName: null, note: null });
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

  it('shows the dropped-note line under the check-your-email message, and the hint with the rules', async () => {
    fetchMock.mockResolvedValue(Response.json({ status: 'check-email', noteDropped: 'phone numbers', queued: false }, { status: 202 }));
    const f = createSignOnForm({ address: '' });
    document.body.append(f.el);
    await settle();
    expect(f.el.querySelectorAll('.strv-sign__hint')[2]!.textContent).toBe(
      'About the maps or the rule. No links, contact details, or attacks on people or parties. We read every note before it appears.',
    );
    expect(byName(f.el, 'note').getAttribute('aria-describedby')).toBe(f.el.querySelectorAll('.strv-sign__hint')[2]!.id);
    fill(f.el);
    widgets[0]!.token('t');
    await submit(f.el);
    const done = q<HTMLElement>(f.el, '.strv-sign__done');
    expect(done.textContent).toBe(`${SENT_COPY}Your name is in, but your note wasn’t added because it included phone numbers.`);
    expect(q(done, '.strv-sign__dropped').textContent).toBe('Your name is in, but your note wasn’t added because it included phone numbers.');
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
    expect(err.textContent).toBe(message);
    expect(byName(f.el, 'email').value).toBe('maria@example.org');
    expect(byName(f.el, 'displayName').value).toBe('Maria G.');
    expect(byName(f.el, 'address').value).toBe('10 Elm St, Denver CO');
    expect(q<HTMLSelectElement>(f.el, '[name="state"]').value).toBe('CO');
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
    expect(q(f.el, '.strv-sign__error').textContent).toBe(WAIT_COPY);
    expect(WAIT_COPY).toBe('Waiting for the check to finish. Try again in a moment.');
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

  it('with lazy set, loads the check on first focus or first submit, not on creation, and can drop its heading', async () => {
    const a = createSignOnForm({ address: '', lazy: true, title: null, focus: false });
    await settle();
    expect(widgets).toHaveLength(0);
    expect(a.el.querySelector('h4')).toBeNull();
    byName(a.el, 'email').dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    await settle();
    expect(widgets).toHaveLength(1);
    const b = createSignOnForm({ address: '', lazy: true, focus: false });
    await settle();
    fill(b.el);
    await submit(b.el);
    expect(q(b.el, '.strv-sign__error').textContent).toBe(WAIT_COPY);
    expect(widgets).toHaveLength(2);
  });

  it('removes the widget when destroyed', async () => {
    const f = createSignOnForm({ address: '' });
    await settle();
    f.destroy();
    expect(widgets[0]!.removed).toBe(true);
  });
});

describe('privacy page and footer', () => {
  it('has the sign-on sections and the visit-count sections, links /remove, and uses no em dash', () => {
    const page = createPrivacyPage();
    expect([...page.el.querySelectorAll('h2')].map((e) => e.textContent)).toEqual([
      'What we collect',
      'What we never keep',
      'What is public',
      'Who sees your email',
      'How to be removed',
      'Services we use',
      'Visit counts',
      'Address lookups',
      'The badge',
      'Kept in your browser',
      'Hosting',
      'Nothing else',
    ]);
    expect(page.el.querySelector('a[href="/remove"]')).not.toBeNull();
    expect(page.el.textContent).toContain('Supabase');
    expect(page.el.textContent).toContain('Cloudflare Turnstile');
    expect(page.el.textContent).toContain('Resend');
    expect(page.el.textContent).toContain('about a week after the link in their confirmation email expires');
    expect(page.el.textContent).toContain('U.S. Census Bureau geocoder');
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
