import { h, clear, config, sharePath, toStateFrame, announce, type LocatedAddress, type Office } from '../../shared';
import { loadStateReps, type Rep } from '../../entities/reps';
import { todaysDistrictsAt, repsFor, type RepsRow } from '../../features/todays-districts';
import { createAskComposer } from '../../features/ask-rep';
import { letterText } from './letter';

export interface RepPanelInput {
  state: string;
  stateName: string;
  located: LocatedAddress | null;
}

export interface RepPanel {
  el: HTMLElement;
  update(input: RepPanelInput): Promise<void>;
  /** Filled in by the signatures work; nothing to show yet. */
  setCounts(c: unknown): void;
  setVoices(el: HTMLElement | null): void;
}

/** "State Senate, district 12", "State House, district 4", "U.S. House, CO-03", "U.S. Senate". */
function officeLabel(state: string, office: Office, code: string): string {
  const num = /^\d+$/.test(code) ? String(Number(code)) : code;
  if (office === 'state-senate') return `State Senate, district ${num}`;
  if (office === 'state-house') return `State House, district ${num}`;
  if (office === 'us-house') return `U.S. House, ${state}-${code}`;
  return 'U.S. Senate';
}

/** Digits and a leading plus only, so nothing else can ride in a tel: link. */
function telHref(phone: string): string {
  const digits = phone.replace(/[^\d]/g, '');
  return `tel:${phone.trim().startsWith('+') ? '+' : ''}${digits}`;
}

async function share(url: string): Promise<void> {
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ url });
      return;
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    announce('Link copied');
  } catch {
    announce('Could not copy the link');
  }
}

export function createRepPanel(): RepPanel {
  const el = h('section', { class: 'strv-reps', 'aria-labelledby': 'strv-reps-h', hidden: true });
  let token = 0;
  /** Closes the composer that is open, if any: one letter at a time. */
  let closeOpen: (() => void) | null = null;

  const hide = (): void => {
    el.hidden = true;
    clear(el);
  };

  const repRow = (input: RepPanelInput, row: RepsRow, rep: Rep, mapUrl: string): HTMLElement => {
    const code = row.key.slice(row.key.lastIndexOf(':') + 1);
    const label = officeLabel(input.state, row.office, code);
    const slot = h('div', { class: 'strv-reps__composer' });
    const ask = h(
      'button',
      {
        type: 'button',
        class: 'strv-button strv-button--signal',
        'aria-expanded': 'false',
        onclick: () => {
          const wasOpen = slot.firstChild !== null;
          closeOpen?.();
          if (wasOpen) return;
          const letter = letterText({ rep, office: row.office, stateName: input.stateName, districtLabel: label, mapUrl });
          slot.append(createAskComposer({ name: rep.name, letter, contactUrl: rep.contactUrl, email: rep.email, phone: rep.phone }));
          ask.setAttribute('aria-expanded', 'true');
          closeOpen = () => {
            clear(slot);
            ask.setAttribute('aria-expanded', 'false');
            closeOpen = null;
          };
        },
      },
      'Ask them to support the rule',
    );
    return h(
      'li',
      { class: 'strv-reps__row' },
      h('div', { class: 'strv-reps__who' }, h('strong', null, rep.name), h('span', { class: 'strv-reps__office' }, label)),
      h(
        'div',
        { class: 'strv-reps__actions' },
        ask,
        rep.phone && h('a', { class: 'strv-button', href: telHref(rep.phone) }, 'Call'),
        h('button', { type: 'button', class: 'strv-button', onclick: () => void share(mapUrl) }, 'Share'),
      ),
      slot,
    );
  };

  async function update(input: RepPanelInput): Promise<void> {
    const mine = ++token;
    closeOpen = null;
    if (!input.located || input.located.state !== input.state) {
      hide();
      return;
    }
    let rows: RepsRow[];
    let found: boolean;
    try {
      const at = toStateFrame(input.state, input.located.lonLat);
      const [reps, d] = await Promise.all([loadStateReps(input.state), todaysDistrictsAt(input.state, at)]);
      rows = repsFor(reps, d);
      found = d.usHouse !== null || d.stateHouse !== null || d.stateSenate !== null;
    } catch {
      if (mine === token) hide();
      return;
    }
    if (mine !== token) return;
    const mapUrl = `https://${config.siteHost}${sharePath(input.state, 'federal-house')}`;
    clear(el);
    const list = h('ul', { class: 'strv-reps__list' });
    for (const row of rows) {
      if (row.missing || row.reps.length === 0) {
        list.append(h('li', { class: 'strv-reps__row strv-reps__row--missing' }, 'We don’t have contact details for this seat yet.'));
        continue;
      }
      for (const rep of row.reps) list.append(repRow(input, row, rep, mapUrl));
    }
    el.append(
      h('h3', { id: 'strv-reps-h', class: 'strv-reps__h' }, 'Who represents you today'),
      h('p', { class: 'strv-reps__intro' }, `Your state legislators draw ${input.stateName}’s maps in most states. Your members of Congress could set one rule for every state.`),
      ...(found ? [] : [h('p', { class: 'strv-reps__none' }, 'We couldn’t place this address in a district.')]),
      list,
    );
    el.hidden = false;
  }

  return { el, update, setCounts: () => undefined, setVoices: () => undefined };
}
