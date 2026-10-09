import { h, describeError, type LonLat } from '../../shared';
import { geocodeAddress, MAX_ADDRESS_LENGTH, type GeocodeResult } from './geocode';
import { describeMultipleMatches } from './resolve';

export interface AddressSearchOptions {
  /** Called with the match; return a sentence to show under the field. */
  onFound(result: GeocodeResult): string | void | Promise<string | void>;
  /** Input id, unique on the page. */
  id: string;
  label?: string;
}

export interface AddressSearch {
  el: HTMLElement;
  setMessage(text: string, tone?: 'info' | 'error'): void;
}

const NOTE =
  'Your address is sent to the U.S. Census Bureau geocoder to find where it is. This site does not keep it. Enter a street address; a PO box cannot be placed on a map.';

export function createAddressSearch(opts: AddressSearchOptions): AddressSearch {
  const input = h('input', {
    id: opts.id,
    name: 'address',
    type: 'text',
    inputmode: 'text',
    autocomplete: 'street-address',
    spellcheck: 'false',
    maxlength: MAX_ADDRESS_LENGTH,
    placeholder: '200 E Colfax Ave, Denver, CO',
    'aria-describedby': `${opts.id}-note ${opts.id}-status`,
    required: true,
  });
  const button = h('button', { type: 'submit', class: 'strv-button strv-button--ink' }, 'Find');
  const status = h('p', { id: `${opts.id}-status`, class: 'strv-search__status', role: 'status', 'aria-live': 'polite' });

  const setMessage = (text: string, tone: 'info' | 'error' = 'info'): void => {
    status.textContent = text;
    status.dataset.tone = tone;
  };

  const form = h(
    'form',
    {
      class: 'strv-search',
      role: 'search',
      novalidate: true,
      onsubmit: async (ev: Event) => {
        ev.preventDefault();
        if (form.dataset.busy === 'true') return;
        form.dataset.busy = 'true';
        // Not disabled: a disabled button would drop keyboard focus.
        button.setAttribute('aria-busy', 'true');
        button.textContent = 'Finding…';
        setMessage('Looking up the address with the Census Bureau…');
        try {
          const result = await geocodeAddress(input.value);
          const msg = ((await opts.onFound(result)) ?? `Found ${result.matchedAddress}.`) + describeMultipleMatches(result.matchCount);
          setMessage(msg);
          // Hand focus from the field to the button: a phone closes its keyboard (and any zoom it applied
          // for the field) so the map is in view, and a keyboard user stays in the form.
          if (document.activeElement === input) button.focus({ preventScroll: true });
        } catch (err) {
          setMessage(describeError(err), 'error');
          input.focus();
        } finally {
          form.dataset.busy = 'false';
          button.removeAttribute('aria-busy');
          button.textContent = 'Find';
        }
      },
    },
    h('label', { for: opts.id, class: 'strv-search__label' }, opts.label ?? 'Find your district by address'),
    h('div', { class: 'strv-search__row' }, input, button),
    h('p', { id: `${opts.id}-note`, class: 'strv-search__note' }, NOTE),
    status,
  );

  return { el: form, setMessage };
}

export type { GeocodeResult, LonLat };
