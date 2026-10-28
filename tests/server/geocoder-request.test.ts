import { describe, expect, it } from 'vitest';
import { GEOCODER } from '../../src/server/shared/config/geocoder.js';
import { geocodeServer } from '../../src/server/features/signon/geocode.js';

describe('the server geocoder request', () => {
  it('sends the configured endpoint and parameters, and format=json', async () => {
    let seen = '';
    const fetchFn = (async (url: URL | string) => {
      seen = String(url);
      return Response.json({ result: { addressMatches: [] } });
    }) as typeof fetch;
    await expect(geocodeServer('1 Main St', fetchFn)).rejects.toMatchObject({ code: 'address-not-found' });
    const u = new URL(seen);
    expect(`${u.origin}${u.pathname}`).toBe(GEOCODER.url);
    expect(Object.fromEntries(u.searchParams)).toEqual({ address: '1 Main St', benchmark: GEOCODER.benchmark, vintage: GEOCODER.vintage, layers: GEOCODER.layers, format: 'json' });
  });
});
