// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GeocodeError } from '../../src/client/shared';

const geocode = vi.hoisted(() => ({ impl: (): Promise<unknown> => Promise.reject(new Error('unset')) }));

vi.mock('../../src/client/features/address-search/geocode', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  geocodeAddress: () => geocode.impl(),
}));

const { createAddressSearch } = await import('../../src/client/features/address-search');

const found = { lonLat: [-104.98, 39.74] as [number, number], state: 'CO', matchedAddress: '200 E COLFAX AVE, DENVER, CO, 80203', matchCount: 1 };

function mount(onFound: () => string | void = () => undefined) {
  const search = createAddressSearch({ id: 'strv-test', onFound });
  document.body.append(search.el);
  const input = search.el.querySelector('input')!;
  const button = search.el.querySelector('button')!;
  return { search, input, button };
}

async function submit(form: HTMLElement): Promise<void> {
  form.dispatchEvent(new Event('submit', { cancelable: true }));
  await vi.waitFor(() => expect(form.dataset.busy).toBe('false'));
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('address search focus', () => {
  it('moves focus from the field to the Find button after a match, so a phone keyboard closes', async () => {
    geocode.impl = () => Promise.resolve(found);
    const { search, input, button } = mount();
    input.value = '200 E Colfax Ave, Denver';
    input.focus();
    await submit(search.el);
    expect(document.activeElement).toBe(button);
  });

  it('keeps focus in the field when the lookup fails', async () => {
    geocode.impl = () => Promise.reject(new GeocodeError('no-match'));
    const { search, input } = mount();
    input.value = 'nowhere at all';
    input.focus();
    await submit(search.el);
    expect(document.activeElement).toBe(input);
  });

  it('leaves focus alone when the visitor moved it during the lookup', async () => {
    const other = document.createElement('button');
    document.body.append(other);
    geocode.impl = () => {
      other.focus();
      return Promise.resolve(found);
    };
    const { search, input } = mount();
    input.value = '200 E Colfax Ave, Denver';
    input.focus();
    await submit(search.el);
    expect(document.activeElement).toBe(other);
  });
});
