import { h, clear, PAGE_META, routeHref, iconArrowLeft, NATIONAL, type Page } from '../../shared';

export const CONFIRM_COPY = {
  h1: 'Confirming your signature',
  working: 'Confirming your signature...',
  noscript: 'Turn on JavaScript to confirm your signature.',
  done: 'You’re signed. Thanks for adding your name.',
  back: 'Back to the maps',
  invalid: 'That link was already used or isn’t valid.',
  expired: 'That link has expired. Sign again to get a new one.',
  fallback: 'That didn’t go through just now. Try again in a minute.',
} as const;

type Outcome = { kind: 'done'; state: string } | { kind: 'invalid' } | { kind: 'expired' } | { kind: 'fallback' };

/** One request per token for as long as the script lives, so a second page object for the same link (a double init) shows the same answer instead of asking again. */
const requests = new Map<string, Promise<Outcome>>();

async function confirmOnce(token: string): Promise<Outcome> {
  try {
    const res = await fetch('/api/confirm', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) });
    const data: unknown = await res.json().catch(() => null);
    const obj = typeof data === 'object' && data !== null ? (data as { state?: unknown; error?: unknown }) : {};
    if (res.status === 200 && typeof obj.state === 'string' && /^[A-Z]{2}$/.test(obj.state)) return { kind: 'done', state: obj.state };
    if (res.status === 410 && obj.error === 'token-expired') return { kind: 'expired' };
    if (res.status === 400 && obj.error === 'token-invalid') return { kind: 'invalid' };
  } catch {
    // Falls through to the plain "try again" notice.
  }
  return { kind: 'fallback' };
}

/**
 * The page the confirmation email links to. With a token, the page script asks the API to confirm as soon as it loads, once,
 * and shows the result. The prerendered copy (`static`) has no script behind it and never confirms anyone; opening the link
 * without running the page script (a mail scanner fetching the HTML) changes nothing.
 */
export function createConfirmPage(token: string | null, mode: 'live' | 'static' = 'live'): Page {
  const h1 = h('h1', { class: 'strv-how__h1', tabindex: -1 }, CONFIRM_COPY.h1);
  const body = h('div', { class: 'strv-privacy__body' });
  const noscript = document.createElement('noscript');
  noscript.textContent = CONFIRM_COPY.noscript;
  let alive = true;

  const show = (outcome: Outcome): void => {
    if (!alive) return;
    clear(body);
    const back = h('a', { href: outcome.kind === 'done' ? `/${outcome.state}?signed=1` : routeHref(NATIONAL), class: 'strv-back' }, iconArrowLeft(), CONFIRM_COPY.back);
    if (outcome.kind === 'done') {
      body.append(h('p', { class: 'strv-sign__done', role: 'status', tabindex: -1 }, CONFIRM_COPY.done), back);
    } else {
      body.append(h('p', { class: 'strv-sign__error', role: 'alert' }, CONFIRM_COPY[outcome.kind]), back);
    }
  };

  if (mode === 'static') {
    body.append(noscript);
  } else if (token === null) {
    show({ kind: 'invalid' });
  } else {
    body.append(h('p', { role: 'status' }, CONFIRM_COPY.working));
    let request = requests.get(token);
    if (!request) {
      request = confirmOnce(token);
      requests.set(token, request);
    }
    void request.then(show);
  }

  const el = h('main', { class: 'strv-how strv-privacy', id: 'strv-main' }, h('header', { class: 'strv-how__head' }, h1), body);
  document.title = PAGE_META.confirm.title;
  return {
    el,
    focusTarget: () => h1,
    destroy() {
      alive = false;
    },
  };
}
