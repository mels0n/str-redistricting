import { describe, expect, it, vi } from 'vitest';

const jsonpCalls = vi.hoisted(() => ({ calls: [] as unknown[][] }));
vi.mock('../../src/client/shared/api/jsonp', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  jsonp: (...args: unknown[]) => {
    jsonpCalls.calls.push(args);
    return Promise.resolve({ result: { addressMatches: [] } });
  },
}));

import { geocodeAddress, parseGeocodeResponse, resolveAddress, type GeocodeResult } from '../../src/client/features/address-search';
import { config } from '../../src/client/shared';
import type { StateIndex } from '../../src/client/entities/state';
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
      matchCount: 1,
      block: null,
    });
  });

  it('reads the census block GEOID when the match carries one', () => {
    const withBlock = {
      result: {
        addressMatches: [
          { ...sample.result.addressMatches[0], geographies: { 'Census Blocks': [{ GEOID: '110019800001034' }] } },
        ],
      },
    };
    expect(parseGeocodeResponse(withBlock).block).toBe('110019800001034');
  });

  it('gives a null block when geographies are missing, empty or malformed', () => {
    const m = sample.result.addressMatches[0];
    const mk = (extra: object) => ({ result: { addressMatches: [{ ...m, ...extra }] } });
    expect(parseGeocodeResponse(sample).block).toBeNull();
    expect(parseGeocodeResponse(mk({ geographies: { 'Census Blocks': [] } })).block).toBeNull();
    expect(parseGeocodeResponse(mk({ geographies: { 'Census Blocks': [{ GEOID: '1100198' }] } })).block).toBeNull();
    expect(parseGeocodeResponse(mk({ geographies: 'x' })).block).toBeNull();
  });

  it('reports no match and unreadable answers as typed errors', () => {
    const none = failure({ result: { addressMatches: [] } });
    expect(none.kind).toBe('no-match');
    expect(describeError(none)).toMatch(/could not find that address/);
    expect(failure({ nope: true }).kind).toBe('bad-response');
  });
});

describe('resolving an address by its census block', () => {
  const summary = {
    population: 1, ideal: 1, rangePersons: 0, rangePct: 0, allContiguous: true,
    assignmentSha256: 'a'.repeat(64), inputSha256: 'b'.repeat(64), lineSearch: 'exact',
  };
  const index: StateIndex = {
    states: [
      { abbr: 'MD', name: 'Maryland', seats: 8, hasData: true, summary },
      { abbr: 'VA', name: 'Virginia', seats: 11, hasData: true, summary },
    ],
  };
  const result = (state: string, block: string | null): GeocodeResult => ({
    lonLat: [0, 0], state, matchedAddress: 'X', matchCount: 1, block,
  });

  it('trusts the block over the reported state', () => {
    expect(resolveAddress(index, result('MD', '110019800001034'), 'MD').kind).toBe('outside');
    expect(resolveAddress(index, result('DC', '240010001001001'), 'MD').kind).toBe('here');
  });

  it('uses the state when there is no block or its FIPS is unknown', () => {
    expect(resolveAddress(index, result('MD', null), 'MD').kind).toBe('here');
    expect(resolveAddress(index, result('MD', '990010001001001'), 'MD').kind).toBe('here');
    expect(resolveAddress(index, result('VA', '510010001001001'), null).kind).toBe('open');
  });
});

describe('geocodeAddress request', () => {
  it('asks the Census geographies endpoint for 2020 blocks with the normalized address', async () => {
    jsonpCalls.calls.length = 0;
    await geocodeAddress('  200  E Colfax Ave,\n Denver, CO ').catch(() => undefined);
    expect(jsonpCalls.calls).toHaveLength(1);
    const [url, params, timeout] = jsonpCalls.calls[0]!;
    expect(url).toBe(config.geocoderUrl);
    expect(String(url).endsWith('/geocoder/geographies/onelineaddress')).toBe(true);
    expect(params).toEqual({
      address: '200 E Colfax Ave, Denver, CO',
      benchmark: 'Public_AR_Current',
      vintage: 'Census2020_Current',
      layers: 'Census Blocks',
    });
    expect(timeout).toBe(config.geocoderTimeoutMs);
  });
});
