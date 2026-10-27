import { h, clear, config, routeHref, PRIVACY } from '../../shared';
import { mountTurnstile, type TurnstileHandle } from './turnstile';

export const SENT_COPY = 'Check your email to confirm. The link works for 48 hours.';
export const QUEUED_COPY =
  'You’re in line. Because so many people are signing, confirmation emails go out in order, and yours should arrive within a day or two. The link works for 48 hours from when it arrives.';

export const SIGN_ERROR_COPY: Readonly<Record<string, string>> = {
  'address-not-found': 'We couldn’t find that address. Check it and try again.',
  'outside-states': 'Signing is open to addresses in the 50 states.',
  'rate-limit': 'Too many tries from here. Try again in an hour.',
  'bot-check': 'The check didn’t go through. Try again.',
};
export const WAIT_COPY = 'Waiting for the check to finish. Try again in a moment.';
export const SIGN_FALLBACK_COPY = 'Couldn’t sign you up just now. Try again in a minute.';

export interface SignOnValues {
  address: string;
  email: string;
  displayName: string;
  showPublic: boolean;
  consentUpdates: boolean;
  turnstileToken: string;
}

/** The body of POST /api/sign: exactly the fields the server's schema takes, nothing more. */
export function signPayload(v: SignOnValues): Record<string, unknown> {
  const name = v.displayName.trim();
  return {
    address: v.address.trim(),
    email: v.email.trim(),
    turnstileToken: v.turnstileToken,
    consentUpdates: v.consentUpdates,
    showPublic: v.showPublic,
    displayName: name === '' ? null : name,
    ref: null,
  };
}

export interface SignOnForm {
  el: HTMLElement;
  destroy(): void;
}

type Outcome = { ok: true; queued: boolean } | { ok: false; message: string };

async function post(body: Record<string, unknown>): Promise<Outcome> {
  try {
    const res = await fetch('/api/sign', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const data: unknown = await res.json().catch(() => null);
    if (res.status === 202) {
      const queued = typeof data === 'object' && data !== null && (data as { queued?: unknown }).queued === true;
      return { ok: true, queued };
    }
    const code = typeof data === 'object' && data !== null ? (data as { error?: unknown }).error : undefined;
    return { ok: false, message: (typeof code === 'string' ? SIGN_ERROR_COPY[code] : undefined) ?? SIGN_FALLBACK_COPY };
  } catch {
    return { ok: false, message: SIGN_FALLBACK_COPY };
  }
}

let uid = 0;

/** The sign-on form. Cloudflare's check loads when the form is created, so a page that never opens it never contacts Cloudflare. */
export function createSignOnForm(input: { address: string }): SignOnForm {
  const n = ++uid;
  const id = (k: string): string => `strv-sign-${k}-${n}`;
  let token = '';
  let handle: TurnstileHandle | null = null;
  let dead = false;

  const field = (key: string, label: string, control: HTMLInputElement, hint?: string): HTMLElement =>
    h('div', { class: 'strv-sign__field' }, h('label', { for: id(key), class: 'strv-search__label' }, label), control, hint && h('span', { class: 'strv-sign__hint', id: id(`${key}-hint`) }, hint));
  const address = h('input', { id: id('address'), name: 'address', type: 'text', autocomplete: 'street-address', required: true, maxlength: 200, minlength: 4, class: 'strv-sign__input' });
  address.value = input.address;
  const email = h('input', { id: id('email'), name: 'email', type: 'email', autocomplete: 'email', required: true, maxlength: 254, class: 'strv-sign__input' });
  const name = h('input', { id: id('name'), name: 'displayName', type: 'text', autocomplete: 'off', maxlength: 40, 'aria-describedby': id('name-hint'), class: 'strv-sign__input' });
  const check = (key: string, label: string): { box: HTMLInputElement; row: HTMLElement } => {
    const box = h('input', { id: id(key), name: key, type: 'checkbox' });
    return { box, row: h('div', { class: 'strv-check' }, box, h('label', { for: id(key) }, h('span', { class: 'strv-check__label' }, label))) };
  };
  const showPublic = check('showPublic', 'Show my name and town on the site');
  const updates = check('consentUpdates', 'Email me updates about Fair Maps');

  const widget = h('div', { class: 'strv-sign__widget' });
  const error = h('p', { class: 'strv-sign__error', role: 'alert' });
  const submit = h('button', { type: 'submit', class: 'strv-button strv-button--ink' }, 'Sign');
  const root = h('div', { class: 'strv-sign' });

  const fail = (message: string): void => {
    error.textContent = message;
  };

  const onSubmit = (ev: Event): void => {
    ev.preventDefault();
    if (submit.disabled) return;
    error.textContent = '';
    if (token === '') {
      fail(WAIT_COPY);
      return;
    }
    const body = signPayload({
      address: address.value,
      email: email.value,
      displayName: name.value,
      showPublic: showPublic.box.checked,
      consentUpdates: updates.box.checked,
      turnstileToken: token,
    });
    submit.disabled = true;
    submit.setAttribute('aria-busy', 'true');
    void post(body).then((out) => {
      submit.disabled = false;
      submit.removeAttribute('aria-busy');
      if (dead) return;
      if (out.ok) {
        clear(root);
        const done = h('p', { class: 'strv-sign__done', role: 'status', tabindex: -1 }, out.queued ? QUEUED_COPY : SENT_COPY);
        root.append(done);
        done.focus();
        handle?.remove();
        handle = null;
        return;
      }
      // A check token is single use; the fields keep what was typed.
      token = '';
      handle?.reset();
      fail(out.message);
    });
  };

  const form = h(
    'form',
    { class: 'strv-sign__form', onsubmit: onSubmit },
    field('address', 'Address', address),
    field('email', 'Email', email),
    field('name', 'Name to show (optional)', name, 'First name and last initial, like Maria G.'),
    showPublic.row,
    updates.row,
    widget,
    error,
    h('div', { class: 'strv-sign__actions' }, submit),
    h('p', { class: 'strv-sign__more' }, 'How we handle your information: ', h('a', { href: routeHref(PRIVACY) }, 'Privacy')),
  );

  root.append(
    h('h4', { class: 'strv-sign__h' }, 'Add your name'),
    h('p', { class: 'strv-sign__lede' }, 'Sign to support the Fair Maps rule. You’ll be counted in your district once you confirm your email. We don’t keep your address.'),
    form,
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
    () => fail(SIGN_FALLBACK_COPY),
  );

  // The form is only created when the visitor opens it, so the first field takes focus once it is in the page.
  queueMicrotask(() => address.focus());

  return {
    el: root,
    destroy() {
      dead = true;
      handle?.remove();
      handle = null;
    },
  };
}
