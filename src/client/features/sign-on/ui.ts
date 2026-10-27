import { h, clear, config, routeHref, PRIVACY } from '../../shared';
import { STATE_NAMES } from '../../entities/state';
import { mountTurnstile, type TurnstileHandle } from './turnstile';

export const SENT_COPY = 'Check your email to confirm. The link works for 48 hours.';
export const QUEUED_COPY =
  'You’re in line. Because so many people are signing, confirmation emails go out in order, and yours should arrive within a day or two. The link works for 48 hours from when it arrives.';

export const SIGN_FALLBACK_COPY = 'Couldn’t sign you up just now. Try again in a minute.';

export const SIGN_ERROR_COPY: Readonly<Record<string, string>> = {
  'address-not-found': 'We couldn’t find that address. Check it and try again.',
  'outside-states': 'Signing is open to addresses in the 50 states.',
  'rate-limit': 'Too many tries from here. Try again in an hour.',
  'bot-check': 'The check didn’t go through. Try again.',
  'bad-request': SIGN_FALLBACK_COPY,
};
export const NOTE_LABEL = 'Why you signed (optional)';
export const NOTE_HINT = 'About the maps or the rule. No links, contact details, or attacks on people or parties. We read every note before it appears.';
/** The second line when the server leaves the note out: `reason` is the server's own wording. */
export const noteDroppedCopy = (reason: string): string => `Your name is in, but your note wasn’t added because it included ${reason}.`;
export const WAIT_COPY = 'Waiting for the check to finish. Try again in a moment.';

export const ADDRESS_HINT = 'Add your street address to be counted in your district and see your representatives. We use it only to find your district and never keep it.';
export const SIGN_LEDE =
  'Sign to support the Fair Maps rule. You’ll be counted once you confirm your email. Add an address and you’ll be counted in your district too. We never keep your address.';

export interface SignOnValues {
  /** Optional: blank means the signer is counted for the state only. */
  address: string;
  /** Two-letter code of one of the 50 states. With an address the server uses the geocoder's state instead. */
  state: string;
  email: string;
  displayName: string;
  showPublic: boolean;
  consentUpdates: boolean;
  note: string;
  shareWithRep: boolean;
  turnstileToken: string;
}

/** The body of POST /api/sign: exactly the fields the server's schema takes, nothing more. */
export function signPayload(v: SignOnValues): Record<string, unknown> {
  const name = v.displayName.trim();
  const note = v.note.trim();
  const address = v.address.trim();
  return {
    address: address === '' ? null : address,
    state: v.state === '' ? null : v.state,
    email: v.email.trim(),
    turnstileToken: v.turnstileToken,
    consentUpdates: v.consentUpdates,
    showPublic: v.showPublic,
    displayName: name === '' ? null : name,
    ref: null,
    note: note === '' ? null : note,
    shareWithRep: v.shareWithRep,
  };
}

export interface SignOnForm {
  el: HTMLElement;
  /** Fills the address and state from a lookup made elsewhere on the page. */
  setLocation(at: { address: string; state: string }): void;
  destroy(): void;
}

type Outcome = { ok: true; queued: boolean; noteDropped: string | null } | { ok: false; message: string };

async function post(body: Record<string, unknown>): Promise<Outcome> {
  try {
    const res = await fetch('/api/sign', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const data: unknown = await res.json().catch(() => null);
    if (res.status === 202) {
      const queued = typeof data === 'object' && data !== null && (data as { queued?: unknown }).queued === true;
      const dropped = typeof data === 'object' && data !== null ? (data as { noteDropped?: unknown }).noteDropped : null;
      return { ok: true, queued, noteDropped: typeof dropped === 'string' && dropped !== '' ? dropped : null };
    }
    const code = typeof data === 'object' && data !== null ? (data as { error?: unknown }).error : undefined;
    return { ok: false, message: (typeof code === 'string' ? SIGN_ERROR_COPY[code] : undefined) ?? SIGN_FALLBACK_COPY };
  } catch {
    return { ok: false, message: SIGN_FALLBACK_COPY };
  }
}

let uid = 0;

/** The sign-on form. Cloudflare's check loads when the form is created, so a page that never opens it never contacts Cloudflare. */
export function createSignOnForm(input: { address: string; state?: string; /** Move focus to the first field (default); false when the form is open from the start. */ focus?: boolean }): SignOnForm {
  const n = ++uid;
  const id = (k: string): string => `strv-sign-${k}-${n}`;
  let token = '';
  let handle: TurnstileHandle | null = null;
  let dead = false;

  const field = (key: string, label: string, control: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, hint?: string): HTMLElement =>
    h('div', { class: 'strv-sign__field' }, h('label', { for: id(key), class: 'strv-search__label' }, label), control, hint && h('span', { class: 'strv-sign__hint', id: id(`${key}-hint`) }, hint));
  const address = h('input', { id: id('address'), name: 'address', type: 'text', autocomplete: 'street-address', maxlength: 200, minlength: 4, 'aria-describedby': id('address-hint'), class: 'strv-sign__input' });
  address.value = input.address;
  const state = h(
    'select',
    { id: id('state'), name: 'state', required: true, autocomplete: 'address-level1', class: 'strv-sign__input' },
    h('option', { value: '' }, 'Choose your state'),
    STATE_NAMES.map((s) => h('option', { value: s.abbr }, s.name)),
  );
  state.value = STATE_NAMES.some((s) => s.abbr === input.state) ? (input.state as string) : '';
  const email = h('input', { id: id('email'), name: 'email', type: 'email', autocomplete: 'email', required: true, maxlength: 254, class: 'strv-sign__input' });
  const name = h('input', { id: id('name'), name: 'displayName', type: 'text', autocomplete: 'off', maxlength: 40, 'aria-describedby': id('name-hint'), class: 'strv-sign__input' });
  const note = h('textarea', { id: id('note'), name: 'note', rows: 3, maxlength: 280, autocomplete: 'off', 'aria-describedby': id('note-hint'), class: 'strv-sign__input strv-sign__note' });
  const check = (key: string, label: string): { box: HTMLInputElement; row: HTMLElement } => {
    const box = h('input', { id: id(key), name: key, type: 'checkbox' });
    return { box, row: h('div', { class: 'strv-check' }, box, h('label', { for: id(key) }, h('span', { class: 'strv-check__label' }, label))) };
  };
  const showPublic = check('showPublic', 'Show my name and town on the site');
  const shareWithRep = check('shareWithRep', 'Share my note with my representative');
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
      state: state.value,
      email: email.value,
      displayName: name.value,
      showPublic: showPublic.box.checked,
      consentUpdates: updates.box.checked,
      note: note.value,
      shareWithRep: shareWithRep.box.checked,
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
        const done = h(
          'p',
          { class: 'strv-sign__done', role: 'status', tabindex: -1 },
          out.queued ? QUEUED_COPY : SENT_COPY,
          out.noteDropped && h('span', { class: 'strv-sign__dropped' }, noteDroppedCopy(out.noteDropped)),
        );
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
    field('email', 'Email', email),
    field('state', 'State', state),
    field('name', 'Name to show (optional)', name, 'First name and last initial, like Maria G.'),
    field('address', 'Address (optional)', address, ADDRESS_HINT),
    field('note', NOTE_LABEL, note, NOTE_HINT),
    showPublic.row,
    shareWithRep.row,
    updates.row,
    widget,
    error,
    h('div', { class: 'strv-sign__actions' }, submit),
    h('p', { class: 'strv-sign__more' }, 'How we handle your information: ', h('a', { href: routeHref(PRIVACY) }, 'Privacy')),
  );

  root.append(
    h('h4', { class: 'strv-sign__h' }, 'Add your name'),
    h('p', { class: 'strv-sign__lede' }, SIGN_LEDE),
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

  // The form is only created when the visitor opens it, so the first field takes focus once it is in the page (unless the form is open from the start).
  if (input.focus !== false) queueMicrotask(() => email.focus());

  return {
    el: root,
    setLocation(at) {
      address.value = at.address;
      if (STATE_NAMES.some((s) => s.abbr === at.state)) state.value = at.state;
    },
    destroy() {
      dead = true;
      handle?.remove();
      handle = null;
    },
  };
}
