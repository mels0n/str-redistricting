import { z } from 'zod';
import { stateByAbbr } from '../../shared/apportionment/index.js';
import { GEOCODER } from '../../shared/config/geocoder.js';
import { SignonError } from '../../shared/errors/signon.js';

// The same endpoint and parameters as the browser's address search, with format=json (see shared/config/geocoder.ts).

const ResponseSchema = z.object({
  result: z.object({
    addressMatches: z.array(
      z.looseObject({
        coordinates: z.object({ x: z.number(), y: z.number() }),
        addressComponents: z.looseObject({ state: z.string(), city: z.string().optional() }),
      }),
    ),
  }),
});

export interface Geocoded {
  lonLat: [number, number];
  state: string;
  town: string | null;
}

/** The first match for an address. `address-not-found` for no match, `outside-states` for anything but the 50 states. */
export async function geocodeServer(address: string, fetchFn: typeof fetch): Promise<Geocoded> {
  const url = new URL(GEOCODER.url);
  url.search = new URLSearchParams({
    address,
    benchmark: GEOCODER.benchmark,
    vintage: GEOCODER.vintage,
    layers: GEOCODER.layers,
    format: 'json',
  }).toString();
  let data: unknown;
  try {
    const res = await fetchFn(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error('geocoder status');
    data = await res.json();
  } catch {
    throw new SignonError('unavailable', 'geocoder unreachable');
  }
  const parsed = ResponseSchema.safeParse(data);
  if (!parsed.success) throw new SignonError('unavailable', 'geocoder bad response');
  const match = parsed.data.result.addressMatches[0];
  if (!match) throw new SignonError('address-not-found');
  const state = match.addressComponents.state.toUpperCase();
  if (!stateByAbbr(state)) throw new SignonError('outside-states');
  const city = match.addressComponents.city?.trim();
  return { lonLat: [match.coordinates.x, match.coordinates.y], state, town: city ? city : null };
}
