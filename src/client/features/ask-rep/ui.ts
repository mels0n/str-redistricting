import { h, announce, type Office } from '../../shared';

export interface AskComposerInput {
  name: string;
  letter: { subject: string; body: string };
  contactUrl: string | null;
  email: string | null;
  phone: string | null;
  /** The office's own site, offered when there is no contact form. */
  website?: string | null;
  office?: Office;
  /** Called when the letter is used: copied, or the contact form or email link followed. */
  onUse?: () => void;
}

/** Subject and body are percent-encoded so the link decodes back to the exact letter. */
export function mailtoHref(email: string, letter: { subject: string; body: string }): string {
  return `mailto:${email}?subject=${encodeURIComponent(letter.subject)}&body=${encodeURIComponent(letter.body)}`;
}

/** Digits and a leading plus only, so nothing else can ride in a tel: link. */
export function telHref(phone: string): string {
  const digits = phone.replace(/[^\d]/g, '');
  return `tel:${phone.trim().startsWith('+') ? '+' : ''}${digits}`;
}

export const HOUSE_FINDER_URL = 'https://www.house.gov/representatives/find-your-representative';
export const HOUSE_HINT = 'Most House offices only accept messages through the contact form on their site.';
export const NO_ONLINE_COPY = 'We don’t have a way to send this to them online. You can call or look up their office.';

/** A contact form link is shown only when it is a web address. */
export function isWebUrl(url: string | null): url is string {
  if (!url) return false;
  try {
    const { protocol } = new URL(url);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

/** Marks this letter as the one to print, so the print styles show nothing else. */
function printLetter(root: HTMLElement): void {
  const doc = document.documentElement;
  const done = (): void => {
    root.removeAttribute('data-printing');
    doc.removeAttribute('data-print-letter');
    window.removeEventListener('afterprint', done);
  };
  root.setAttribute('data-printing', '');
  doc.setAttribute('data-print-letter', '');
  window.addEventListener('afterprint', done);
  window.print();
}

const COPY_FAILED = 'Could not copy. Select the letter and copy it by hand.';

/** The letter and the ways to send it. With no contact form and no email, only copy, print and the phone number. */
export function createAskComposer(input: AskComposerInput): HTMLElement {
  const { letter, email, phone } = input;
  const contactUrl = isWebUrl(input.contactUrl) ? input.contactUrl : null;
  const website = isWebUrl(input.website ?? null) ? (input.website as string) : null;
  const status = h('span', { class: 'strv-ask__status', role: 'status' });
  const copyText = (text: string, done: string): void => {
    if (typeof navigator === 'undefined' || !navigator.clipboard) {
      status.textContent = COPY_FAILED;
      return;
    }
    navigator.clipboard.writeText(text).then(
      () => {
        status.textContent = done;
        announce(done);
      },
      () => {
        status.textContent = COPY_FAILED;
      },
    );
  };
  const copy = h(
    'button',
    {
      type: 'button',
      class: 'strv-button strv-button--ink',
      onclick: () => {
        input.onUse?.();
        copyText(`${letter.subject}

${letter.body}`, 'Copied');
      },
    },
    'Copy letter',
  );
  const actions = h('div', { class: 'strv-ask__actions' }, copy, h('button', { type: 'button', class: 'strv-button', onclick: () => printLetter(root) }, 'Print'), status);
  const dest = (...kids: (Node | string | false | null)[]): HTMLElement => h('li', { class: 'strv-ask__dest' }, ...kids);
  const online = email !== null || contactUrl !== null;
  const where = h(
    'div',
    { class: 'strv-ask__where' },
    h('p', { class: 'strv-ask__where-h' }, h('strong', null, 'Where to send it')),
    h(
      'ul',
      { class: 'strv-ask__dests' },
      email && dest('Email: ', h('span', { class: 'strv-ask__addr' }, email), h('button', { type: 'button', class: 'strv-button', onclick: () => copyText(email, 'Email address copied') }, 'Copy email'), h('a', { class: 'strv-button', href: mailtoHref(email, letter), onclick: () => input.onUse?.() }, 'Email')),
      contactUrl && dest(h('a', { class: 'strv-button', href: contactUrl, target: '_blank', rel: 'noopener', onclick: () => input.onUse?.() }, 'Open their contact form')),
      website && dest(h('a', { class: 'strv-button', href: website, target: '_blank', rel: 'noopener' }, 'Their website'), !contactUrl && input.office === 'us-house' && h('span', { class: 'strv-ask__hint' }, HOUSE_HINT)),
      phone && dest('Phone: ', h('a', { href: telHref(phone) }, phone)),
    ),
    !online && h('p', { class: 'strv-ask__none' }, NO_ONLINE_COPY),
    !contactUrl && input.office === 'us-house' && h('p', { class: 'strv-ask__none' }, h('a', { href: HOUSE_FINDER_URL, target: '_blank', rel: 'noopener' }, 'House contact form finder')),
  );
  const root = h(
    'div',
    { class: 'strv-ask', role: 'group', 'aria-label': `Letter to ${input.name}` },
    where,
    h('p', { class: 'strv-ask__subject' }, h('strong', null, 'Subject: '), letter.subject),
    h('pre', { class: 'strv-ask__letter' }, letter.body),
    actions,
  );
  return root;
}
