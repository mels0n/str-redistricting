import { h, getLocated, setLocated, formatInt, type LocatedAddress } from '../../shared';
import { nameOfState } from '../../entities/state';
import { loadCounts, shownCounts } from '../../entities/counts';
import { createAddressSearch, stateFromBlock } from '../../features/address-search';
import { createSignOnForm } from '../../features/sign-on';
import { createRepPanel, type MakeVoices } from './panel';

export interface TakeActionOptions {
  /** Unique on the page; the address field and headings take their ids from it. */
  id: string;
  /** A state to start the sign-on form on (from a link such as /act?state=CO). */
  state?: string | null;
  /** Makes the notes of a district; the page supplies it. */
  makeVoices?: MakeVoices;
}

export interface TakeAction {
  el: HTMLElement;
  destroy(): void;
}

export const SEARCH_NOTE = 'Sent to the Census Bureau geocoder to find your districts. We never keep it.';

const countLine = (national: number, state: number, stateName: string | null): string => {
  const total = national === 1 ? '1 person has signed' : `${formatInt(national)} people have signed`;
  return state > 0 && stateName ? `${total}, ${formatInt(state)} in ${stateName}` : total;
};

/**
 * The take-action page body, in three numbered steps: find your representatives by address, ask them (all at once or one
 * at a time), and add your name. An address is never required to sign. The bot check loads only when the sign-on form
 * is focused or scrolled into view, so the page ships no script of its own.
 */
export function createTakeAction(opts: TakeActionOptions): TakeAction {
  const panel = createRepPanel(opts.makeVoices);
  const startState = opts.state && nameOfState(opts.state) ? opts.state : '';
  const signForm = createSignOnForm({ address: '', state: startState, focus: false, lazy: true, title: null });
  let dead = false;
  let stateCounts: { state: string; n: number } | null = null;
  let national: number | null = null;

  const count = h('p', { class: 'strv-act__count', hidden: true });
  const paintCount = (stateName: string | null): void => {
    if (national === null || national <= 0) {
      count.hidden = true;
      return;
    }
    count.textContent = countLine(national, stateCounts?.n ?? 0, stateName);
    count.hidden = false;
  };
  void loadCounts().then((raw) => {
    const c = shownCounts(raw);
    if (dead || !c) return;
    national = c.national;
    paintCount(null);
  });

  const show = async (at: LocatedAddress): Promise<void> => {
    signForm.setLocation({ address: at.matchedAddress, state: at.state });
    const stateName = nameOfState(at.state);
    void loadCounts(at.state).then((raw) => {
      const c = shownCounts(raw);
      if (dead || !c) return;
      national = c.national;
      stateCounts = { state: at.state, n: c.state };
      paintCount(stateName);
    });
    await panel.update({ state: at.state, stateName: stateName ?? at.state, located: at });
  };

  const search = createAddressSearch({
    id: `${opts.id}-address`,
    label: 'Your street address',
    note: SEARCH_NOTE,
    async onFound(result) {
      // A late answer must not remember an address for a visitor who has gone elsewhere.
      if (dead) return undefined;
      const abbr = stateFromBlock(result);
      if (!nameOfState(abbr)) return `${result.matchedAddress} is not in one of the 50 states, so there are no representatives to show for it here.`;
      const at: LocatedAddress = { state: abbr, lonLat: result.lonLat, matchedAddress: result.matchedAddress, ...(result.block !== null && { block: result.block }) };
      setLocated(at);
      await show(at);
      return `Found ${result.matchedAddress}.`;
    },
  });

  const step = (key: string, title: string, ...kids: (Node | false | null)[]): HTMLElement => {
    const headId = `${opts.id}-${key}-h`;
    return h('section', { class: `strv-act__step strv-act__step--${key}`, 'aria-labelledby': headId }, h('h2', { id: headId, class: 'strv-act__step-h' }, title), ...kids);
  };

  const el = h(
    'div',
    { class: 'strv-act' },
    step('find', 'Find your representatives', search.el),
    h('div', { class: 'strv-act__cols' }, step('ask', 'Ask them', panel.el), step('sign', 'Add your name', count, signForm.el)),
    panel.voices,
  );

  // An address looked up earlier on this visit (on a state page) shows its representatives right away.
  const earlier = getLocated();
  if (earlier && nameOfState(earlier.state)) void show(earlier);

  return {
    el,
    destroy() {
      dead = true;
      signForm.destroy();
      panel.destroy();
    },
  };
}
