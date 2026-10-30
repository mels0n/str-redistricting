import type { BadgeRepo } from '../../entities/badge-db/index.js';
import { normalizeReferrer } from './referrer.js';

/** The most pages the table holds; a new page is refused beyond this. */
export const MAX_SIGHTINGS = 5000;
const REWRITE_AFTER_MS = 3_600_000;

export interface RecordDeps {
  repo: BadgeRepo;
  /** Hosts that are ours (the site and localhost): never recorded. */
  ownHosts: readonly string[];
  /** Counts this request against the visitor's allowance; throws when it is used up. Called only when a write would happen. */
  limit: () => Promise<void>;
  now: Date;
  maxRows?: number;
}

export type RecordOutcome = 'recorded' | 'ignored' | 'fresh' | 'limited' | 'full' | 'crowded';

/** Rows one host may hold; a new page of a host that already has this many is refused. */
export const MAX_PER_HOST = 3;

/** A page not verified in this long is checked again right after it is seen. */
export const RECHECK_AFTER_MS = 24 * 3_600_000;

export interface Recorded {
  outcome: RecordOutcome;
  /** The stored page address when something was written; the caller may check it right away. */
  url: string | null;
  /** True when the page is new or has not been verified in the last 24 hours. */
  needsCheck: boolean;
}

/**
 * Notes that the badge image was asked for by a page of another site. Only the page address from the Referer header is kept, with
 * its query and fragment removed. At most one write per page per hour (a page seen within the hour costs one read and nothing
 * else), writes are limited per visitor network through `limit`, and a new page is refused once the table holds `maxRows` or its host already holds 3.
 */
export async function recordSighting(referer: string | null, deps: RecordDeps): Promise<Recorded> {
  const none = (outcome: RecordOutcome): Recorded => ({ outcome, url: null, needsCheck: false });
  const page = normalizeReferrer(referer, deps.ownHosts);
  if (!page) return none('ignored');
  const row = await deps.repo.find(page.url);
  if (row !== null && deps.now.getTime() - Date.parse(row.lastSeen) < REWRITE_AFTER_MS) return none('fresh');
  try {
    await deps.limit();
  } catch {
    return none('limited');
  }
  if (row === null && (await deps.repo.count()) >= (deps.maxRows ?? MAX_SIGHTINGS)) return none('full');
  if (row === null && (await deps.repo.countHost(page.host)) >= MAX_PER_HOST) return none('crowded');
  await deps.repo.touch(page.url, page.host, deps.now.toISOString());
  const old = (iso: string | null, ms: number): boolean => iso === null || deps.now.getTime() - Date.parse(iso) >= ms;
  // A new page, or one never checked, is checked now. A page that is verified and not failing is checked again after a day. One that
  // is failing, or has never passed, is left to the daily run, so a page that does not show the badge cannot use the hourly allowance.
  const stale = row === null || row.lastChecked === null || (row.verifiedAt !== null && row.consecutiveFailures === 0 && old(row.verifiedAt, RECHECK_AFTER_MS) && old(row.lastChecked, REWRITE_AFTER_MS));
  return { outcome: 'recorded', url: page.url, needsCheck: stale };
}
