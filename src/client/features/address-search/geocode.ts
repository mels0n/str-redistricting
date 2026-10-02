import { z } from 'zod';
import { config, jsonp, JsonpError, GeocodeError, type LonLat } from '../../shared';

const ResponseSchema = z.object({
  result: z.object({
    addressMatches: z.array(
      z.looseObject({
        matchedAddress: z.string(),
        coordinates: z.object({ x: z.number(), y: z.number() }),
        addressComponents: z.looseObject({ state: z.string() }),
      }),
    ),
  }),
});

export interface GeocodeResult {
  lonLat: LonLat;
  /** Two-letter state code, as the Census Bureau reports it. */
  state: string;
  matchedAddress: string;
}

/** Pure parser for a geocoder answer: the first match, or a typed failure. */
export function parseGeocodeResponse(data: unknown): GeocodeResult {
  const parsed = ResponseSchema.safeParse(data);
  if (!parsed.success) throw new GeocodeError('bad-response');
  const match = parsed.data.result.addressMatches[0];
  if (!match) throw new GeocodeError('no-match');
  return {
    lonLat: [match.coordinates.x, match.coordinates.y],
    state: match.addressComponents.state.toUpperCase(),
    matchedAddress: match.matchedAddress,
  };
}

/**
 * Looks up an address with the U.S. Census Bureau geocoder (one-line
 * address, current public address ranges). The Bureau's service answers
 * browsers through JSONP only, so that is how it is called.
 */
export async function geocodeAddress(address: string): Promise<GeocodeResult> {
  const text = address.trim();
  if (text.length < 4) throw new GeocodeError('empty');
  let data: unknown;
  try {
    data = await jsonp(
      config.geocoderUrl,
      { address: text, benchmark: config.geocoderBenchmark },
      config.geocoderTimeoutMs,
    );
  } catch (cause) {
    throw new GeocodeError(cause instanceof JsonpError && cause.kind === 'timeout' ? 'timeout' : 'network', { cause });
  }
  return parseGeocodeResponse(data);
}
