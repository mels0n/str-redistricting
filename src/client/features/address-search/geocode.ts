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
  /** How many matches the Census Bureau returned; the first is the one used. */
  matchCount: number;
}

/** Longest address sent to the geocoder. */
export const MAX_ADDRESS_LENGTH = 200;

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
    matchCount: parsed.data.result.addressMatches.length,
  };
}

/** Trims, collapses runs of whitespace and caps the length of a typed address. */
export function normalizeAddress(address: string): string {
  return address.replace(/\s+/g, ' ').trim().slice(0, MAX_ADDRESS_LENGTH);
}

/** Maps a failed JSONP call to the typed lookup failure the visitor sees. */
export function geocodeFailureFrom(cause: unknown): GeocodeError {
  if (cause instanceof JsonpError) {
    if (cause.kind === 'timeout') return new GeocodeError('timeout', { cause });
    if (cause.kind === 'no-callback') return new GeocodeError('bad-response', { cause });
  }
  return new GeocodeError('network', { cause });
}

/**
 * Looks up an address with the U.S. Census Bureau geocoder (one-line
 * address, current public address ranges). The Bureau's service answers
 * browsers through JSONP only, so that is how it is called.
 */
export async function geocodeAddress(address: string): Promise<GeocodeResult> {
  const text = normalizeAddress(address);
  if (text.length < 4) throw new GeocodeError('empty');
  let data: unknown;
  try {
    data = await jsonp(
      config.geocoderUrl,
      { address: text, benchmark: config.geocoderBenchmark },
      config.geocoderTimeoutMs,
    );
  } catch (cause) {
    throw geocodeFailureFrom(cause);
  }
  return parseGeocodeResponse(data);
}
