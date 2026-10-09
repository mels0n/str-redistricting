import { dataUrl, getDataRelease, setDataRelease, VersionsSchema, type Versions } from '../config';
import { clearFetchCache, fetchJson } from './fetch-json';

/**
 * The versions behind the data that is actually published (public/data/versions.json), as opposed to the site's
 * bundled VERSIONS. Null when the file is missing or invalid: nothing is stamped yet, so nothing is claimed.
 */
export async function loadPublishedVersions(): Promise<Versions | null> {
  try {
    return await fetchJson(dataUrl('versions.json'), VersionsSchema);
  } catch {
    return null;
  }
}

/**
 * Learns the published maps release once, at boot, so every data URL after it carries it as ?v=. With no versions
 * file (nothing stamped yet) the URLs stay plain.
 */
export async function initDataRelease(): Promise<void> {
  setDataRelease((await loadPublishedVersions())?.maps ?? null);
}

let onSkew: ((release: number) => void) | null = null;

/** Registers what to do when a file from a different release than the session's turns up (the app reloads). */
export function setSkewHandler(handler: ((release: number) => void) | null): void {
  onSkew = handler;
}

/**
 * Compares the release a state's stamp names with the session's. A different one means a release went out while the
 * page was open: the cached files and the ones about to be fetched may belong to two releases. The session moves to
 * the new release, the cache is dropped, and the handler is told. Data with no stamp, or a session with no known
 * release, has nothing to compare. Returns whether a skew was found.
 */
export function checkRelease(stamp: { maps: number } | undefined): boolean {
  const known = getDataRelease();
  if (!stamp || known === null || stamp.maps === known) return false;
  setDataRelease(stamp.maps);
  clearFetchCache();
  onSkew?.(stamp.maps);
  return true;
}
