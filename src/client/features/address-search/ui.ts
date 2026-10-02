import { h, describeError, type LonLat } from '../../shared';
import { geocodeAddress, type GeocodeResult } from './geocode';

export interface AddressSearchOptions {
  /** Called with the match; return a sentence to show under the field. */
  onFound(result: GeocodeResult): string | void;
  /** Input id, unique on the page. */
  id: string;
  label?: string;
}

export interface AddressSearch {
  el: HTMLElement;
  setMessage(text: string, tone?: 'info' | 'error'): void;
}

const NOTE =
  'Your address is sent to the U.S. Census Bureau geocoder to find where it is. This site does not keep it.';

export function createAddressSearch(opts: AddressSearchOptions): AddressSearch {
  const input = h('input', {
    id: opts.id,
    name: 'address',
    type: 'text',
    inputmode: 'text',
    autocomplete: 'street-address',
    spellcheck: 'false',
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
        button.disabled = true;
        setMessage('Looking up the address with the Census Bureau…');
        try {
          const result = await geocodeAddress(input.value);
          const msg = opts.onFound(result);
          setMessage(msg ?? `Found ${result.matchedAddress}.`);
        } catch (err) {
          setMessage(describeError(err), 'error');
          input.focus();
        } finally {
          form.dataset.busy = 'false';
          button.disabled = false;
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
