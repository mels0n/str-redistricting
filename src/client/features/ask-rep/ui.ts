import { h, announce } from '../../shared';

export interface AskComposerInput {
  name: string;
  letter: { subject: string; body: string };
  contactUrl: string | null;
  email: string | null;
  phone: string | null;
}

/** Subject and body are percent-encoded so the link decodes back to the exact letter. */
function mailtoHref(email: string, letter: { subject: string; body: string }): string {
  return `mailto:${email}?subject=${encodeURIComponent(letter.subject)}&body=${encodeURIComponent(letter.body)}`;
}

/** A contact form link is shown only when it is a web address. */
function isWebUrl(url: string | null): url is string {
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
  const status = h('span', { class: 'strv-ask__status', role: 'status' });
  const copy = h(
    'button',
    {
      type: 'button',
      class: 'strv-button strv-button--ink',
      onclick: () => {
        const text = `${letter.subject}\n\n${letter.body}`;
        if (typeof navigator === 'undefined' || !navigator.clipboard) {
          status.textContent = COPY_FAILED;
          return;
        }
        navigator.clipboard.writeText(text).then(
          () => {
            status.textContent = 'Copied';
            announce('Copied');
          },
          () => {
            status.textContent = COPY_FAILED;
          },
        );
      },
    },
    'Copy letter',
  );
  const actions = h(
    'div',
    { class: 'strv-ask__actions' },
    copy,
    contactUrl && h('a', { class: 'strv-button', href: contactUrl, target: '_blank', rel: 'noopener' }, 'Open their contact form'),
    email && h('a', { class: 'strv-button', href: mailtoHref(email, letter) }, 'Email'),
    h('button', { type: 'button', class: 'strv-button', onclick: () => printLetter(root) }, 'Print'),
    status,
  );
  const root = h(
    'div',
    { class: 'strv-ask', role: 'group', 'aria-label': `Letter to ${input.name}` },
    h('p', { class: 'strv-ask__subject' }, h('strong', null, 'Subject: '), letter.subject),
    h('pre', { class: 'strv-ask__letter' }, letter.body),
    actions,
    !contactUrl && !email && phone && h('p', { class: 'strv-ask__phone' }, `Phone: ${phone}`),
  );
  return root;
}
