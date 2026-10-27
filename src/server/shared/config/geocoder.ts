/** The Census Bureau geocoder request the sign-up makes. The browser's address search asks the same service the same way; a test keeps the two in step. */
export const GEOCODER = {
  url: 'https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress',
  benchmark: 'Public_AR_Current',
  vintage: 'Census2020_Current',
  layers: 'Census Blocks',
} as const;
