import { h, announce, type Office } from '../../shared';
import type { Rep } from '../../entities/reps';
import { recordAsk } from '../../entities/counts';
import { groupLetterText } from './letter';
import { fittingMailtoHref, uniqueEmails } from './mailto';

export interface EveryoneRep {
  /** The district key of the seat, for the ask counter. */
  key: string;
  office: Office;
  /** "State Senate, district 12" and the like. */
  label: string;
  rep: Rep;
}

export interface EveryoneInput {
  stateName: string;
  places: readonly { office: Office; code: string }[];
  mapUrl: string;
  reps: readonly EveryoneRep[];
}

export const TOO_LONG_COPY = 'Too long to open as a link. Copy the addresses and the letter into a new message.';
export const NO_EMAIL_COPY = 'None of them list an email address. Copy the letter and use each contact form below.';
const COPY_FAILED = 'Could not copy. Select the text and copy it by hand.';

/** One letter for everyone: a primary Email everyone at once button, Copy letter, and the letter shown once. */
export function createEveryone(input: EveryoneInput): HTMLElement {
  const letter = groupLetterText({ stateName: input.stateName, places: input.places, mapUrl: input.mapUrl });
  const withEmail = input.reps.filter((r) => r.rep.email);
  const emails = uniqueEmails(withEmail.map((r) => r.rep.email as string));
  const href = fittingMailtoHref(emails, letter);
  const status = h('span', { class: 'strv-ask__status', role: 'status' });

  const count = (rows: readonly EveryoneRep[]): void => {
    for (const r of rows) recordAsk(r.key, r.office);
  };
  const copy = (text: string, done: string, rows: readonly EveryoneRep[]): void => {
    count(rows);
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

  const actions = h('div', { class: 'strv-act__actions' });
  if (href) actions.append(h('a', { class: 'strv-button strv-button--signal', href, onclick: () => count(withEmail) }, 'Email everyone at once'));
  if (emails.length > 0) actions.append(h('button', { type: 'button', class: `strv-button${href ? '' : ' strv-button--signal'}`, onclick: () => copy(emails.join(', '), 'Copied', withEmail) }, 'Copy emails'));
  actions.append(h('button', { type: 'button', class: 'strv-button', onclick: () => copy(`${letter.subject}\n\n${letter.body}`, 'Copied', input.reps) }, 'Copy letter'), status);

  return h(
    'div',
    { class: 'strv-act__all', role: 'group', 'aria-label': 'Email everyone at once' },
    actions,
    emails.length > 0 && h('p', { class: 'strv-act__addrs' }, h('strong', null, 'To: '), emails.join(', ')),
    emails.length === 0 && h('p', { class: 'strv-act__hint' }, NO_EMAIL_COPY),
    emails.length > 0 && !href && h('p', { class: 'strv-act__hint' }, TOO_LONG_COPY),
    h('details', { class: 'strv-act__letter' }, h('summary', null, 'Read the letter'), h('p', { class: 'strv-ask__subject' }, h('strong', null, 'Subject: '), letter.subject), h('pre', { class: 'strv-ask__letter' }, letter.body)),
  );
}
