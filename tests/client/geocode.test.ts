import { describe, expect, it } from 'vitest';
import { parseGeocodeResponse } from '../../src/client/features/address-search';
import { GeocodeError, describeError } from '../../src/client/shared/lib/errors';

const sample = {
  result: {
    input: { address: { address: '200 E Colfax Ave, Denver, CO' } },
    addressMatches: [
      {
        coordinates: { x: -104.984403184626, y: 39.739996725077 },
        addressComponents: { state: 'CO', zip: '80203' },
        matchedAddress: '200 E COLFAX AVE, DENVER, CO, 80203',
      },
    ],
  },
};

function failure(data: unknown): GeocodeError {
  try {
    parseGeocodeResponse(data);
  } catch (e) {
    if (e instanceof GeocodeError) return e;
  }
  throw new Error('expected a GeocodeError');
}

describe('geocoder response', () => {
  it('reads the first match', () => {
    expect(parseGeocodeResponse(sample)).toEqual({
      lonLat: [-104.984403184626, 39.739996725077],
      state: 'CO',
      matchedAddress: '200 E COLFAX AVE, DENVER, CO, 80203',
    });
  });

  it('reports no match and unreadable answers as typed errors', () => {
    const none = failure({ result: { addressMatches: [] } });
    expect(none.kind).toBe('no-match');
    expect(describeError(none)).toMatch(/could not find that address/);
    expect(failure({ nope: true }).kind).toBe('bad-response');
  });
});
