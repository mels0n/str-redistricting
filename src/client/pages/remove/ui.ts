import { h, clear, config, PAGE_META, routeHref, iconArrowLeft, NATIONAL, type Page } from '../../shared';
import { mountTurnstile, WAIT_COPY, type TurnstileHandle } from '../../features/sign-on';

export const REMOVE_COPY = {
  h1: 'Remove your signature',
  askLede: 'Enter the email you signed with. We’ll send a link that removes your signature, your note and your email from Fair Maps for good.',
  sent: 'If that email is signed up, a removal link is on its way. It works for 48 hours.',
  confirmLede: 'This permanently removes your signature, your note and your email. Your district’s count goes down by one.',
  removed: 'You’ve been removed. Thanks for having been part of it.',
  invalid: 'This link was already used or isn’t valid.',
  expired: 'This link has expired. Ask for a new one above.',
  rateLimit: 'Too many tries from here. Try again in an hour.',
  botCheck: 'The check didn’t go through. Try again.',
  fallback: 'That didn’t go through just now. Try again in a minute.',
} as const;

const ERROR_COPY: Readonly<Record<string, string>> = { 'rate-limit': REMOVE_COPY.rateLimit, 'bot-check': REMOVE_COPY.botCheck };

async function postJson(url: string, body: Record<string, unknown>): Promise<{ status: number; error: string | null }> {
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const data: unknown = await res.json().catch(() => null);
    const error = typeof data === 'object' && data !== null && typeof (data as { error?: unknown }).error === 'string' ? (data as { error: string }).error : null;
    return { status: res.status, error };
  } catch {
    return { status: 0, error: null };
  }
}

const status = (text: string): HTMLElement => h('p', { class: 'strv-sign__done', role: 'status', tabindex: -1 }, text);

/** The form that asks for a removal link. Cloudflare's check loads when the form is created. */
function createRequestForm(): { el: HTMLElement; destroy(): void } {
  let token = '';
  let handle: TurnstileHandle | null = null;
  let dead = false;
  const email = h('input', { id: 'strv-remove-email', name: 'email', type: 'email', autocomplete: 'email', required: true, maxlength: 254, class: 'strv-sign__input' });
  const widget = h('div', { class: 'strv-sign__widget' });
  const error = h('p', { class: 'strv-sign__error', role: 'alert' });
  const submit = h('button', { type: 'submit', class: 'strv-button strv-button--ink' }, 'Send removal link');
  const root = h('div', { class: 'strv-sign' });

  const onSubmit = (ev: Event): void => {
    ev.preventDefault();
    if (submit.disabled) return;
    error.textContent = '';
    if (token === '') {
      error.textContent = WAIT_COPY;
      return;
    }
    submit.disabled = true;
    submit.setAttribute('aria-busy', 'true');
    void postJson('/api/remove-request', { email: email.value.trim(), turnstileToken: token }).then((out) => {
      submit.disabled = false;
      submit.removeAttribute('aria-busy');
      if (dead) return;
      if (out.status === 202) {
        clear(root);
        const done = status(REMOVE_COPY.sent);
        root.append(done);
        done.focus();
        handle?.remove();
        handle = null;
        return;
      }
      // A check token is single use.
      token = '';
      handle?.reset();
      error.textContent = (out.error !== null ? ERROR_COPY[out.error] : undefined) ?? REMOVE_COPY.fallback;
    });
  };

  root.append(
    h(
      'form',
      { class: 'strv-sign__form', onsubmit: onSubmit },
      h('div', { class: 'strv-sign__field' }, h('label', { for: 'strv-remove-email', class: 'strv-search__label' }, 'Email'), email),
      widget,
      error,
      h('div', { class: 'strv-sign__actions' }, submit),
    ),
  );
  mountTurnstile(widget, config.turnstileSiteKey, {
    onToken: (t) => {
      token = t;
    },
    onClear: () => {
      token = '';
    },
  }).then(
    (hd) => {
      if (dead) hd.remove();
      else handle = hd;
    },
    () => {
      error.textContent = REMOVE_COPY.fallback;
    },
  );
  return {
    el: root,
    destroy() {
      dead = true;
      handle?.remove();
      handle = null;
    },
  };
}

/**
 * The removal page. Without a token it asks for the email; with one it shows a button, and only pressing it calls the API.
 * Opening the link never removes anyone, so an email scanner that visits it changes nothing.
 */
export function createRemovePage(token: string | null): Page {
  const h1 = h('h1', { class: 'strv-how__h1', tabindex: -1 }, REMOVE_COPY.h1);
  const body = h('div', { class: 'strv-privacy__body' });
  let request: { el: HTMLElement; destroy(): void } | null = null;

  const showRequest = (into: HTMLElement): void => {
    request?.destroy();
    request = createRequestForm();
    into.append(request.el);
  };

  if (token === null) {
    showRequest(body);
  } else {
    const top = h('div', { class: 'strv-remove__top' });
    const result = h('div', { class: 'strv-remove__result' });
    const button = h('button', { type: 'button', class: 'strv-button strv-button--ink' }, 'Remove me');
    button.addEventListener('click', () => {
      if (button.disabled) return;
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      void postJson('/api/remove', { token }).then((out) => {
        button.removeAttribute('aria-busy');
        clear(result);
        if (out.status === 200) {
          clear(body);
          const done = status(REMOVE_COPY.removed);
          body.append(done);
          done.focus();
          return;
        }
        button.disabled = false;
        let text: string = REMOVE_COPY.fallback;
        if (out.status === 400 && out.error === 'token-invalid') {
          text = REMOVE_COPY.invalid;
          button.disabled = true;
        } else if (out.status === 410 && out.error === 'token-expired') {
          // "Ask for a new one above": the request form opens above the message.
          text = REMOVE_COPY.expired;
          button.disabled = true;
          if (request === null) showRequest(top);
        }
        const msg = h('p', { class: 'strv-sign__error', role: 'alert' }, text);
        result.append(msg);
      });
    });
    body.append(top, h('p', null, REMOVE_COPY.confirmLede), h('div', { class: 'strv-sign__actions' }, button), result);
  }

  const el = h(
    'main',
    { class: 'strv-how strv-privacy', id: 'strv-main' },
    h(
      'header',
      { class: 'strv-how__head' },
      h('a', { href: routeHref(NATIONAL), class: 'strv-back' }, iconArrowLeft(), 'All states'),
      h1,
      token === null ? h('p', { class: 'strv-how__lede' }, REMOVE_COPY.askLede) : null,
    ),
    body,
  );
  document.title = PAGE_META.remove.title;
  return {
    el,
    focusTarget: () => h1,
    destroy() {
      request?.destroy();
    },
  };
}
