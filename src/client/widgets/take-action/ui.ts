import { h, clear, getLocated, setLocated, type LocatedAddress } from '../../shared';
import { nameOfState } from '../../entities/state';
import { createAddressSearch, stateFromBlock } from '../../features/address-search';
import { createSignOnForm, type SignOnForm } from '../../features/sign-on';
import { createRepPanel, type MakeVoices } from './panel';

export interface TakeActionOptions {
  /** Unique on the page; the address field and headings take their ids from it. */
  id: string;
  /** The widget's own heading. Null when the page already has a heading for it. */
  heading?: { level: 2 | 3; text: string } | null;
  /** A state to start the sign-on form on (from a link such as /act?state=CO). */
  state?: string | null;
  /** Makes the notes of a district; the page supplies it. */
  makeVoices?: MakeVoices;
}

export interface TakeAction {
  el: HTMLElement;
  destroy(): void;
}

/**
 * The take-action steps, the same on the home page and on /act: find your representatives by address, ask them (one at a
 * time or all at once), and add your name. An address is never required to sign.
 */
export function createTakeAction(opts: TakeActionOptions): TakeAction {
  const panel = createRepPanel(opts.makeVoices);
  const startState = opts.state && nameOfState(opts.state) ? opts.state : '';
  let signForm: SignOnForm | null = null;
  let located: LocatedAddress | null = null;
  let dead = false;

  const show = async (at: LocatedAddress): Promise<void> => {
    located = at;
    signForm?.setLocation({ address: at.matchedAddress, state: at.state });
    await panel.update({ state: at.state, stateName: nameOfState(at.state) ?? at.state, located: at });
  };

  const search = createAddressSearch({
    id: `${opts.id}-address`,
    label: 'Your street address',
    async onFound(result) {
      // A late answer must not remember an address for a visitor who has gone elsewhere.
      if (dead) return undefined;
      const abbr = stateFromBlock(result);
      if (!nameOfState(abbr)) return `${result.matchedAddress} is not in one of the 50 states, so there are no representatives to show for it here.`;
      const at: LocatedAddress = { state: abbr, lonLat: result.lonLat, matchedAddress: result.matchedAddress, ...(result.block !== null && { block: result.block }) };
      setLocated(at);
      await show(at);
      return `Found ${result.matchedAddress}. Your representatives are below.`;
    },
  });

  const signSlot = h('div', { class: 'strv-act__sign-slot' });
  const signButton = h(
    'button',
    {
      type: 'button',
      class: 'strv-button strv-button--signal',
      'aria-expanded': 'false',
      'aria-controls': `${opts.id}-sign`,
      onclick: () => {
        if (signForm) {
          signForm.destroy();
          signForm = null;
          clear(signSlot);
          signButton.setAttribute('aria-expanded', 'false');
          return;
        }
        signForm = createSignOnForm({ address: located?.matchedAddress ?? '', state: located?.state ?? startState });
        signSlot.append(signForm.el);
        signButton.setAttribute('aria-expanded', 'true');
      },
    },
    'Add your name',
  );
  signSlot.id = `${opts.id}-sign`;

  const headId = `${opts.id}-h`;
  const heading = opts.heading ? h(opts.heading.level === 2 ? 'h2' : 'h3', { id: headId, class: 'strv-act__h' }, opts.heading.text) : null;
  const el = h(
    'section',
    { class: 'strv-act', ...(heading ? { 'aria-labelledby': headId } : { 'aria-label': 'Take action' }) },
    heading,
    heading && h('p', { class: 'strv-act__lede' }, 'Your state legislators draw most of the maps, and Congress could set one rule for every state. Tell them you want districts drawn by a rule, then add your name.'),
    h('div', { class: 'strv-act__step' }, h('h3', { class: 'strv-act__step-h' }, 'Find your representatives'), search.el),
    panel.el,
    h(
      'div',
      { class: 'strv-act__step strv-act__step--sign' },
      h('h3', { class: 'strv-act__step-h' }, 'Add your name'),
      h('p', { class: 'strv-act__note' }, 'You don’t need an address to sign. Choose your state, confirm your email, and you’re counted.'),
      signButton,
      signSlot,
    ),
  );

  // An address looked up earlier on this visit (on a state page) shows its representatives right away.
  const earlier = getLocated();
  if (earlier && nameOfState(earlier.state)) void show(earlier);

  return {
    el,
    destroy() {
      dead = true;
      signForm?.destroy();
      signForm = null;
      panel.destroy();
    },
  };
}
