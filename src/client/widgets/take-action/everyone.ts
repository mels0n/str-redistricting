import { h, announce, type Office } from '../../shared';
import type { Rep } from '../../entities/reps';
import { recordAsk } from '../../entities/counts';
import { isWebUrl, telHref, HOUSE_FINDER_URL, HOUSE_HINT } from '../../features/ask-rep';
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

let uid = 0;

export const TOO_LONG_COPY = 'This letter is too long to open in your email app as a link. Copy the addresses and the letter, then paste them into a new message.';

/** "Email all of them at once": one letter to every representative with an email address, and a checklist for the rest. */
export function createEveryone(input: EveryoneInput): HTMLElement {
  const n = ++uid;
  const letter = groupLetterText({ stateName: input.stateName, places: input.places, mapUrl: input.mapUrl });
  const emails = uniqueEmails(input.reps.flatMap((r) => (r.rep.email ? [r.rep.email] : [])));
  const href = fittingMailtoHref(emails, letter);
  const status = h('span', { class: 'strv-ask__status', role: 'status' });
  const COPY_FAILED = 'Could not copy. Select the text and copy it by hand.';

  const countFor = (rows: readonly EveryoneRep[]): void => {
    for (const r of rows) recordAsk(r.key, r.office);
  };
  const copy = (text: string, done: string, rows: readonly EveryoneRep[]): void => {
    countFor(rows);
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
  const withEmail = input.reps.filter((r) => r.rep.email);
  const without = input.reps.filter((r) => !r.rep.email);

  const actions = h('div', { class: 'strv-ask__actions' });
  if (href) actions.append(h('a', { class: 'strv-button strv-button--signal', href, onclick: () => countFor(withEmail) }, 'Email everyone'));
  else if (emails.length > 0) actions.append(h('button', { type: 'button', class: 'strv-button strv-button--signal', onclick: () => copy(emails.join(', '), 'Email addresses copied', withEmail) }, 'Copy emails'));
  actions.append(h('button', { type: 'button', class: 'strv-button strv-button--ink', onclick: () => copy(`${letter.subject}\n\n${letter.body}`, 'Copied', input.reps) }, 'Copy letter'), status);

  const checklist = h('ul', { class: 'strv-act__todo' });
  for (const r of without) {
    const li = h('li', { class: 'strv-act__todo-item' });
    const done = h('span', { class: 'strv-act__done', hidden: true }, 'Done');
    const mark = (): void => {
      li.setAttribute('data-done', 'true');
      done.hidden = false;
      recordAsk(r.key, r.office);
    };
    const contact = isWebUrl(r.rep.contactUrl) ? r.rep.contactUrl : null;
    const site = !contact && isWebUrl(r.rep.website) ? r.rep.website : null;
    const links: HTMLElement[] = [];
    if (contact) links.push(h('a', { class: 'strv-button', href: contact, target: '_blank', rel: 'noopener', onclick: mark }, 'Open their contact form'));
    if (site) links.push(h('a', { class: 'strv-button', href: site, target: '_blank', rel: 'noopener', onclick: mark }, 'Their website'));
    if (r.rep.phone) links.push(h('a', { class: 'strv-button', href: telHref(r.rep.phone), onclick: mark }, `Call ${r.rep.phone}`));
    li.append(
      h('span', { class: 'strv-act__todo-who' }, h('strong', null, r.rep.name), ' ', h('span', { class: 'strv-act__todo-office' }, r.label)),
      links.length > 0 ? h('span', { class: 'strv-act__todo-links' }, ...links, done) : h('span', { class: 'strv-act__todo-office' }, 'No contact details published.'),
    );
    checklist.append(li);
  }
  const houseOnly = without.some((r) => r.office === 'us-house' && !isWebUrl(r.rep.contactUrl));

  const headId = `strv-act-all-${n}`;
  return h(
    'section',
    { class: 'strv-act__all', 'aria-labelledby': headId },
    h('h3', { id: headId, class: 'strv-reps__h' }, 'Email all of them at once'),
    h(
      'p',
      { class: 'strv-reps__intro' },
      emails.length > 0
        ? 'One letter, addressed to every representative who lists an email address. Your email app opens with it ready to send.'
        : 'None of your representatives list an email address, but you can copy one letter and send it through each contact form below.',
    ),
    actions,
    emails.length > 0 && !href && h('p', { class: 'strv-ask__none' }, TOO_LONG_COPY),
    h('details', { class: 'strv-act__letter' }, h('summary', null, 'Read the letter'), h('p', { class: 'strv-ask__subject' }, h('strong', null, 'Subject: '), letter.subject), h('pre', { class: 'strv-ask__letter' }, letter.body)),
    without.length > 0 && h('h4', { class: 'strv-act__sub' }, emails.length > 0 ? 'These offices do not list an email address' : 'Send it to each office'),
    without.length > 0 && checklist,
    houseOnly && h('p', { class: 'strv-ask__hint' }, HOUSE_HINT, ' ', h('a', { href: HOUSE_FINDER_URL, target: '_blank', rel: 'noopener' }, 'House contact form finder')),
  );
}
