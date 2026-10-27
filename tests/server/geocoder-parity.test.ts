import { describe, expect, it } from 'vitest';
import { config } from '../../src/client/shared';
import { GEOCODER } from '../../src/server/shared/config/geocoder.js';
import { geocodeServer } from '../../src/server/features/signon/geocode.js';

// The sign-up asks the Census geocoder from the server and the address search asks it from the browser. They cannot import
// one another, so this test keeps the endpoint and parameters the same.
describe('the server and the browser ask the geocoder the same way', () => {
  it('uses the same endpoint, benchmark, vintage and layers', () => {
    expect(GEOCODER.url).toBe(config.geocoderUrl);
    expect(GEOCODER.benchmark).toBe(config.geocoderBenchmark);
    expect(GEOCODER.vintage).toBe(config.geocoderVintage);
    expect(GEOCODER.layers).toBe(config.geocoderLayers);
  });

  it('sends those parameters, and format=json, in the request', async () => {
    let seen = '';
    const fetchFn = (async (url: URL | string) => {
      seen = String(url);
      return Response.json({ result: { addressMatches: [] } });
    }) as typeof fetch;
    await expect(geocodeServer('1 Main St', fetchFn)).rejects.toMatchObject({ code: 'address-not-found' });
    const u = new URL(seen);
    expect(`${u.origin}${u.pathname}`).toBe(config.geocoderUrl);
    expect(Object.fromEntries(u.searchParams)).toEqual({
      address: '1 Main St',
      benchmark: config.geocoderBenchmark,
      vintage: config.geocoderVintage,
      layers: config.geocoderLayers,
      format: 'json',
    });
  });
});
