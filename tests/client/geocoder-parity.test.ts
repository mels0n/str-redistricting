import { describe, expect, it } from 'vitest';
import { config } from '../../src/client/shared';
import { GEOCODER } from '../../src/server/shared/config/geocoder';

// The sign-up asks the Census geocoder from the server and the address search asks it from the browser. They cannot import
// one another, so this test keeps the endpoint and parameters the same.
describe('the server and the browser ask the geocoder the same way', () => {
  it('uses the same endpoint, benchmark, vintage and layers', () => {
    expect(GEOCODER.url).toBe(config.geocoderUrl);
    expect(GEOCODER.benchmark).toBe(config.geocoderBenchmark);
    expect(GEOCODER.vintage).toBe(config.geocoderVintage);
    expect(GEOCODER.layers).toBe(config.geocoderLayers);
  });
});
