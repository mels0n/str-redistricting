import { h, clear, config, sharePath, toStateFrame, districtKey, type LocatedAddress, type Office } from '../../shared';
import { loadStateReps, STATEWIDE_CODE, type Rep } from '../../entities/reps';
import { recordAsk } from '../../entities/counts';
import { loadPledges, inPledgeOrder, type Pledge } from '../../entities/pledges';
import { todaysDistrictsAt, repsFor, type RepsRow } from '../../features/todays-districts';
import { createAskComposer, isWebUrl, mailtoHref, telHref } from '../../features/ask-rep';
import { createEveryone, type EveryoneRep } from './everyone';
import { letterText } from './letter';

/** A district's "why I signed" notes. A sibling widget makes them, so the page hands in the maker. */
export interface VoicesView {
  el: HTMLElement;
  destroy(): void;
}
export type MakeVoices = (districtKey: string) => VoicesView;

export interface RepPanelInput {
  state: string;
  stateName: string;
  located: LocatedAddress | null;
}

export interface RepPanel {
  el: HTMLElement;
  /** Where the notes of the visitor's U.S. House district appear (the page places it); empty until there are some. */
  voices: HTMLElement;
  update(input: RepPanelInput): Promise<void>;
  destroy(): void;
}

export const IDLE_COPY = 'Enter your address above to see who represents you.';
export const LOADING_COPY = 'Finding your representatives…';
export const FAILED_COPY = 'We couldn’t load your representatives. Try again in a moment.';
export const NOT_PLACED_COPY = 'We couldn’t place this address in a district.';

/** "State Senate, district 12", "State House, district 4", "U.S. House, CO-03", "U.S. Senate". */
function officeLabel(state: string, office: Office, code: string): string {
  const num = /^\d+$/.test(code) ? String(Number(code)) : code;
  if (office === 'state-senate') return `State Senate, district ${num}`;
  if (office === 'state-house') return `State House, district ${num}`;
  if (office === 'us-house') return `U.S. House, ${state}-${code}`;
  return 'U.S. Senate';
}

const codeOf = (key: string): string => key.slice(key.lastIndexOf(':') + 1);

/** The "Ask them" step: who represents the address, one letter to all of them, and a row of actions for each. */
export function createRepPanel(makeVoices?: MakeVoices): RepPanel {
  const el = h('div', { class: 'strv-reps' });
  const voicesSlot = h('div', { class: 'strv-reps__voices' });
  let token = 0;
  let voices: VoicesView | null = null;
  /** Closes the composer that is open, if any: one letter at a time. */
  let closeOpen: (() => void) | null = null;

  const message = (text: string, tone: 'idle' | 'busy' | 'error' = 'idle'): void => {
    clear(el);
    el.append(h('p', { class: 'strv-reps__empty', 'data-tone': tone, role: tone === 'error' ? 'alert' : 'status' }, text));
  };
  message(IDLE_COPY);

  const dropVoices = (): void => {
    voices?.destroy();
    voices = null;
    clear(voicesSlot);
  };

  const repRow = (input: RepPanelInput, row: RepsRow, rep: Rep, mapUrl: string, pledge: Pledge | undefined): HTMLElement => {
    const code = codeOf(row.key);
    const letter = letterText({ rep, office: row.office, stateName: input.stateName, districtCode: code, mapUrl });
    const slot = h('div', { class: 'strv-reps__composer' });
    const done = h('span', { class: 'strv-reps__done', hidden: true }, 'Done');
    const li = h('li', { class: 'strv-reps__row' });
    const mark = (): void => {
      li.setAttribute('data-done', 'true');
      done.hidden = false;
    };
    const write = h(
      'button',
      {
        type: 'button',
        class: 'strv-button',
        'aria-expanded': 'false',
        onclick: () => {
          const wasOpen = slot.firstChild !== null;
          closeOpen?.();
          if (wasOpen) return;
          slot.append(
            createAskComposer({
              name: rep.name,
              letter,
              contactUrl: rep.contactUrl,
              email: rep.email,
              phone: rep.phone,
              website: rep.website,
              office: row.office,
              onUse: () => {
                recordAsk(row.key, row.office);
                mark();
              },
            }),
          );
          write.setAttribute('aria-expanded', 'true');
          closeOpen = () => {
            clear(slot);
            write.setAttribute('aria-expanded', 'false');
            closeOpen = null;
          };
        },
      },
      'Write to them',
    );
    const contact = isWebUrl(rep.contactUrl) ? rep.contactUrl : null;
    const site = !contact && isWebUrl(rep.website) ? rep.website : null;
    li.append(
      h(
        'div',
        { class: 'strv-reps__who' },
        h('strong', null, rep.name),
        h('span', { class: 'strv-reps__office' }, officeLabel(input.state, row.office, code)),
        pledge && h('span', { class: 'strv-reps__pledged' }, 'Pledged'),
        pledge && h('a', { class: 'strv-reps__statement', href: pledge.statementUrl, rel: 'noopener' }, 'Statement'),
        done,
      ),
      h(
        'div',
        { class: 'strv-reps__actions' },
        write,
        rep.email &&
          h(
            'a',
            {
              class: 'strv-button',
              href: mailtoHref(rep.email, letter),
              onclick: () => {
                recordAsk(row.key, row.office);
                mark();
              },
            },
            'Email',
          ),
        contact &&
          h(
            'a',
            {
              class: 'strv-button',
              href: contact,
              target: '_blank',
              rel: 'noopener',
              onclick: () => {
                recordAsk(row.key, row.office);
                mark();
              },
            },
            'Contact form',
          ),
        site && h('a', { class: 'strv-button', href: site, target: '_blank', rel: 'noopener', onclick: mark }, 'Website'),
        rep.phone && h('a', { class: 'strv-button', href: telHref(rep.phone), onclick: mark }, 'Call'),
      ),
      slot,
    );
    return li;
  };

  /** Candidates for the seats shown who have pledged; nothing unless the site is set to show candidates. */
  const candidatesSection = (input: RepPanelInput, rows: RepsRow[], pledges: Pledge[]): HTMLElement[] => {
    if (!config.showCandidates) return [];
    const keys = new Set(rows.map((r) => r.key));
    const mine = inPledgeOrder(pledges).filter((p) => p.role === 'candidate' && keys.has(`${p.state}:${p.office}:${p.districtCode ?? STATEWIDE_CODE}`));
    if (mine.length === 0) return [];
    return [
      h(
        'div',
        { class: 'strv-reps__candidates' },
        h('h4', null, 'Candidates for this seat who support the rule'),
        h(
          'ul',
          null,
          mine.map((p) => h('li', null, h('strong', null, p.name), ' ', officeLabel(input.state, p.office, p.districtCode ?? ''), ' ', h('a', { href: p.statementUrl, rel: 'noopener' }, 'Statement'))),
        ),
      ),
    ];
  };

  async function update(input: RepPanelInput): Promise<void> {
    const mine = ++token;
    closeOpen = null;
    dropVoices();
    if (!input.located || input.located.state !== input.state) {
      message(IDLE_COPY);
      return;
    }
    message(LOADING_COPY, 'busy');
    let rows: RepsRow[];
    let found: boolean;
    let usHouse: string | null;
    let pledges: Pledge[] = [];
    try {
      const at = toStateFrame(input.state, input.located.lonLat);
      // A pledges list that will not load only means no badges; it never hides the representatives.
      const [reps, d, pl] = await Promise.all([loadStateReps(input.state), todaysDistrictsAt(input.state, at), loadPledges().catch((): Pledge[] => [])]);
      pledges = pl;
      rows = repsFor(reps, d);
      usHouse = d.usHouse;
      found = d.usHouse !== null || d.stateHouse !== null || d.stateSenate !== null;
    } catch {
      if (mine === token) message(FAILED_COPY, 'error');
      return;
    }
    if (mine !== token) return;
    const mapUrl = `https://${config.siteHost}${sharePath(input.state, 'federal-house')}`;
    clear(el);
    const list = h('ul', { class: 'strv-reps__list' });
    const everyone: EveryoneRep[] = [];
    for (const row of rows) {
      if (row.missing || row.reps.length === 0) {
        list.append(h('li', { class: 'strv-reps__row strv-reps__row--missing' }, 'We don’t have contact details for this seat yet.'));
        continue;
      }
      for (const rep of row.reps) {
        const pledge = pledges.find((p) => p.role === 'incumbent' && p.personId === rep.id);
        list.append(repRow(input, row, rep, mapUrl, pledge));
        everyone.push({ key: row.key, office: row.office, label: officeLabel(input.state, row.office, codeOf(row.key)), rep });
      }
    }
    const places = rows.filter((r) => r.office !== 'us-senate').map((r) => ({ office: r.office, code: codeOf(r.key) }));
    el.append(
      ...(found ? [] : [h('p', { class: 'strv-reps__none' }, NOT_PLACED_COPY)]),
      ...(everyone.length > 0 ? [createEveryone({ stateName: input.stateName, places, mapUrl, reps: everyone })] : []),
      list,
      ...candidatesSection(input, rows, pledges),
    );
    if (usHouse !== null && makeVoices) {
      voices = makeVoices(districtKey(input.state, 'us-house', usHouse));
      voicesSlot.append(voices.el);
    }
  }

  return {
    el,
    voices: voicesSlot,
    update,
    destroy() {
      token++;
      dropVoices();
    },
  };
}
