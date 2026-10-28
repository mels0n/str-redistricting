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

export type RecordOutcome = 'recorded' | 'ignored' | 'fresh' | 'limited' | 'full';

/**
 * Notes that the badge image was asked for by a page of another site. Only the page address from the Referer header is kept, with
 * its query and fragment removed. At most one write per page per hour (a page seen within the hour costs one read and nothing
 * else), writes are limited per visitor network through `limit`, and a new page is refused once the table holds `maxRows`.
 */
export async function recordSighting(referer: string | null, deps: RecordDeps): Promise<RecordOutcome> {
  const page = normalizeReferrer(referer, deps.ownHosts);
  if (!page) return 'ignored';
  const seen = await deps.repo.lastSeen(page.url);
  if (seen !== null && deps.now.getTime() - Date.parse(seen) < REWRITE_AFTER_MS) return 'fresh';
  try {
    await deps.limit();
  } catch {
    return 'limited';
  }
  if (seen === null && (await deps.repo.count()) >= (deps.maxRows ?? MAX_SIGHTINGS)) return 'full';
  await deps.repo.touch(page.url, page.host, deps.now.toISOString());
  return 'recorded';
}
