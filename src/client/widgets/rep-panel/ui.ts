import { h, clear, config, getLocated, sharePath, toStateFrame, announce, type LocatedAddress, type Office } from '../../shared';
import { loadStateReps, STATEWIDE_CODE, type Rep } from '../../entities/reps';
import { recordAsk, type DistrictCounts } from '../../entities/counts';
import { loadPledges, inPledgeOrder, type Pledge } from '../../entities/pledges';
import { todaysDistrictsAt, repsFor, type RepsRow } from '../../features/todays-districts';
import { createAskComposer } from '../../features/ask-rep';
import { createSignOnForm, type SignOnForm } from '../../features/sign-on';
import { letterText } from './letter';

export interface RepPanelInput {
  state: string;
  stateName: string;
  located: LocatedAddress | null;
}

export interface RepPanel {
  el: HTMLElement;
  update(input: RepPanelInput): Promise<void>;
  /** Shows how many people signed and asked in each district; null (or no numbers yet) shows no count lines. */
  setCounts(c: DistrictCounts | null): void;
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
  let counts: DistrictCounts | null = null;
  /** The count line of each rendered row, by district key. */
  let countLines: { key: string; el: HTMLElement }[] = [];
  const paintCounts = (): void => {
    for (const { key, el: line } of countLines) {
      const signed = counts?.byKey[key] ?? 0;
      const asked = counts?.byKey[`${key}#asks`] ?? 0;
      const parts: string[] = [];
      if (signed > 0) parts.push(`${signed} ${signed === 1 ? 'person' : 'people'} in this district signed`);
      if (asked > 0) parts.push(`${asked} asked this office`);
      line.textContent = parts.join('. ');
      line.hidden = parts.length === 0;
    }
  };
  const el = h('section', { class: 'strv-reps', 'aria-labelledby': 'strv-reps-h', hidden: true });
  let token = 0;
  /** Closes the composer that is open, if any: one letter at a time. */
  let closeOpen: (() => void) | null = null;
  /** The sign-on form that is open, if any. */
  let signForm: SignOnForm | null = null;

  const hide = (): void => {
    signForm?.destroy();
    signForm = null;
    el.hidden = true;
    clear(el);
  };

  const repRow = (input: RepPanelInput, row: RepsRow, rep: Rep, mapUrl: string, pledge: Pledge | undefined): HTMLElement => {
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
          slot.append(createAskComposer({ name: rep.name, letter, contactUrl: rep.contactUrl, email: rep.email, phone: rep.phone, onUse: () => recordAsk(row.key, row.office) }));
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
    const countLine = h('p', { class: 'strv-reps__count', hidden: true });
    countLines.push({ key: row.key, el: countLine });
    return h(
      'li',
      { class: 'strv-reps__row' },
      h(
        'div',
        { class: 'strv-reps__who' },
        h('strong', null, rep.name),
        h('span', { class: 'strv-reps__office' }, label),
        pledge && h('span', { class: 'strv-reps__pledged' }, 'Pledged'),
        pledge && h('a', { class: 'strv-reps__statement', href: pledge.statementUrl, rel: 'noopener' }, 'Statement'),
      ),
      h(
        'div',
        { class: 'strv-reps__actions' },
        ask,
        rep.phone && h('a', { class: 'strv-button', href: telHref(rep.phone) }, 'Call'),
        h('button', { type: 'button', class: 'strv-button', onclick: () => void share(mapUrl) }, 'Share'),
      ),
      countLine,
      slot,
    );
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

  /** The "Add your name" button and the slot its form opens in; the address comes from the last lookup. */
  const signSection = (input: RepPanelInput): HTMLElement => {
    const slot = h('div', { class: 'strv-reps__sign' });
    const open = h(
      'button',
      {
        type: 'button',
        class: 'strv-button',
        'aria-expanded': 'false',
        onclick: () => {
          if (signForm) {
            signForm.destroy();
            signForm = null;
            clear(slot);
            open.setAttribute('aria-expanded', 'false');
            return;
          }
          signForm = createSignOnForm({ address: (getLocated() ?? input.located)?.matchedAddress ?? '' });
          slot.append(signForm.el);
          open.setAttribute('aria-expanded', 'true');
        },
      },
      'Add your name',
    );
    return h('div', { class: 'strv-reps__signon' }, open, slot);
  };

  async function update(input: RepPanelInput): Promise<void> {
    const mine = ++token;
    closeOpen = null;
    signForm?.destroy();
    signForm = null;
    if (!input.located || input.located.state !== input.state) {
      hide();
      return;
    }
    let rows: RepsRow[];
    let found: boolean;
    let pledges: Pledge[] = [];
    try {
      const at = toStateFrame(input.state, input.located.lonLat);
      // A pledges list that will not load only means no badges; it never hides the representatives.
      const [reps, d, pl] = await Promise.all([loadStateReps(input.state), todaysDistrictsAt(input.state, at), loadPledges().catch((): Pledge[] => [])]);
      pledges = pl;
      rows = repsFor(reps, d);
      found = d.usHouse !== null || d.stateHouse !== null || d.stateSenate !== null;
    } catch {
      if (mine === token) hide();
      return;
    }
    if (mine !== token) return;
    const mapUrl = `https://${config.siteHost}${sharePath(input.state, 'federal-house')}`;
    clear(el);
    countLines = [];
    const list = h('ul', { class: 'strv-reps__list' });
    for (const row of rows) {
      if (row.missing || row.reps.length === 0) {
        list.append(h('li', { class: 'strv-reps__row strv-reps__row--missing' }, 'We don’t have contact details for this seat yet.'));
        continue;
      }
      for (const rep of row.reps) {
        const pledge = pledges.find((p) => p.role === 'incumbent' && p.personId === rep.id);
        list.append(repRow(input, row, rep, mapUrl, pledge));
      }
    }
    el.append(
      h('h3', { id: 'strv-reps-h', class: 'strv-reps__h' }, 'Who represents you today'),
      h('p', { class: 'strv-reps__intro' }, `Your state legislators draw ${input.stateName}’s maps in most states. Your members of Congress could set one rule for every state.`),
      ...(found ? [] : [h('p', { class: 'strv-reps__none' }, 'We couldn’t place this address in a district.')]),
      list,
      ...candidatesSection(input, rows, pledges),
      signSection(input),
    );
    paintCounts();
    el.hidden = false;
  }

  return { el, update, setCounts(c) {
      counts = c;
      paintCounts();
    },
     setVoices: () => undefined };
}
