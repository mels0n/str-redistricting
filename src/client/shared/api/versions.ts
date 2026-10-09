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

/** How long boot waits for versions.json before starting with plain URLs. */
export const BOOT_TIMEOUT_MS = 3_000;

/** One uncached read of versions.json that gives up after `timeoutMs`; null on any failure. */
async function readPublished(timeoutMs: number, noStore: boolean): Promise<Versions | null> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(dataUrl('versions.json'), { signal: controller.signal, ...(noStore ? { cache: 'no-store' as const } : {}) });
    if (!res.ok) return null;
    const parsed = VersionsSchema.safeParse(await res.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

/**
 * Learns the published maps release once, at boot, so every data URL after it carries it as ?v=. With no versions
 * file (nothing stamped yet), or none within a few seconds, the URLs stay plain and the app starts anyway.
 */
export async function initDataRelease(timeoutMs: number = BOOT_TIMEOUT_MS): Promise<void> {
  setDataRelease((await readPublished(timeoutMs, false))?.maps ?? null);
}

let onSkew: ((release: number) => void) | null = null;

/** Registers what to do when versions.json confirms a newer release than the session's (the app reloads). */
export function setSkewHandler(handler: ((release: number) => void) | null): void {
  onSkew = handler;
}

/** The highest stamp already confirmed against versions.json this session, so one stamp costs at most one check. */
let checkedUpTo = 0;
let checking = false;

/**
 * Compares the release a state's stamp names with the session's. States can legitimately carry different releases
 * (a partial publish after a maps bump), so only a stamp NEWER than the session's is suspect, and the session's
 * release never moves down. A newer stamp is only a hint: versions.json is re-read uncached, and only when it
 * itself names a newer release than the session booted with did a release really go out; then the cache is
 * dropped and the handler is told (the app reloads, at most once per release). A newer stamp with versions.json
 * unchanged is a mixed publish, not skew, and changes nothing. Returns whether a skew was confirmed.
 */
export async function checkRelease(stamp: { maps: number } | undefined): Promise<boolean> {
  const known = getDataRelease();
  if (!stamp || known === null || stamp.maps <= known || stamp.maps <= checkedUpTo || checking) return false;
  checking = true;
  try {
    const published = await readPublished(BOOT_TIMEOUT_MS, true);
    checkedUpTo = Math.max(checkedUpTo, stamp.maps);
    if (!published || published.maps <= known) return false;
    clearFetchCache();
    onSkew?.(published.maps);
    return true;
  } finally {
    checking = false;
  }
}
