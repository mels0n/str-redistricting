import type { LonLat } from './geo';

/**
 * The last address the visitor looked up, kept in memory only. It is never
 * written to the URL or to storage, so a shared link never carries a
 * visitor's location.
 */
export interface LocatedAddress {
  state: string;
  lonLat: LonLat;
  matchedAddress: string;
  /** The address's 15-digit 2020 census block GEOID, when the geocoder gave one. */
  block?: string;
}

let current: LocatedAddress | null = null;

export function setLocated(value: LocatedAddress | null): void {
  current = value;
}

export function getLocated(): LocatedAddress | null {
  return current;
}
