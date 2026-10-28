import type { SupabaseClient } from '@supabase/supabase-js';

/** A page seen showing the badge, with what the daily check has found. */
export interface Sighting {
  url: string;
  host: string;
  firstSeen: string;
  lastSeen: string;
  verifiedAt: string | null;
  lastChecked: string | null;
  consecutiveFailures: number;
  title: string | null;
}

/** What one check found. A failed check carries the new failure count. */
export interface CheckResult {
  checkedAt: string;
  consecutiveFailures: number;
  /** Set only by a check that found the badge: the page's title (or null) and the time it was verified. */
  verified: { title: string | null } | null;
}

/** A failed check count at or above this unlists a site. */
export const UNLIST_AFTER_FAILURES = 2;

/** The data access for badge sightings. Tests pass an in-memory implementation. */
export interface BadgeRepo {
  /** When the page was last seen, or null if it is not in the table. */
  lastSeen(url: string): Promise<string | null>;
  count(): Promise<number>;
  /** Adds the page or, if it is there, only moves last_seen: what the checks found is kept. */
  touch(url: string, host: string, nowIso: string): Promise<void>;
  /** Pages not checked since `beforeIso` (never checked first, then the oldest check), up to `limit`. */
  dueForCheck(beforeIso: string, limit: number): Promise<Sighting[]>;
  recordCheck(url: string, result: CheckResult): Promise<void>;
  /** Verified pages that are still listed, newest first. */
  listed(limit: number): Promise<Sighting[]>;
  /** Deletes pages not seen and not verified since `beforeIso`. */
  prune(beforeIso: string): Promise<void>;
}

const fail = (): never => {
  throw new Error('database error');
};

const COLUMNS = 'url, host, first_seen, last_seen, verified_at, last_checked, consecutive_failures, title';

interface Row {
  url: string;
  host: string;
  first_seen: string;
  last_seen: string;
  verified_at: string | null;
  last_checked: string | null;
  consecutive_failures: number;
  title: string | null;
}

const toSighting = (r: Row): Sighting => ({
  url: r.url,
  host: r.host,
  firstSeen: r.first_seen,
  lastSeen: r.last_seen,
  verifiedAt: r.verified_at,
  lastChecked: r.last_checked,
  consecutiveFailures: r.consecutive_failures,
  title: r.title,
});

/** The service-role client is handed in (the api layer owns the connection). */
export function badgeRepo(client: SupabaseClient): BadgeRepo {
  return {
    async lastSeen(url) {
      const { data, error } = await client.from('badge_sightings').select('last_seen').eq('url', url).maybeSingle();
      if (error) fail();
      return data ? String((data as { last_seen: string }).last_seen) : null;
    },
    async count() {
      const { count, error } = await client.from('badge_sightings').select('url', { count: 'exact', head: true });
      if (error) fail();
      return count ?? 0;
    },
    async touch(url, host, nowIso) {
      // Only these columns are written, so an existing row keeps its first_seen and its check results.
      const { error } = await client.from('badge_sightings').upsert({ url, host, last_seen: nowIso }, { onConflict: 'url' });
      if (error) fail();
    },
    async dueForCheck(beforeIso, limit) {
      const { data, error } = await client
        .from('badge_sightings')
        .select(COLUMNS)
        .or(`last_checked.is.null,last_checked.lt.${beforeIso}`)
        .order('last_checked', { ascending: true, nullsFirst: true })
        .limit(limit);
      if (error) fail();
      return ((data ?? []) as unknown as Row[]).map(toSighting);
    },
    async recordCheck(url, result) {
      const patch: Record<string, unknown> = { last_checked: result.checkedAt, consecutive_failures: result.consecutiveFailures };
      if (result.verified) Object.assign(patch, { verified_at: result.checkedAt, title: result.verified.title });
      const { error } = await client.from('badge_sightings').update(patch).eq('url', url);
      if (error) fail();
    },
    async listed(limit) {
      const { data, error } = await client
        .from('badge_sightings')
        .select(COLUMNS)
        .not('verified_at', 'is', null)
        .lt('consecutive_failures', UNLIST_AFTER_FAILURES)
        .order('first_seen', { ascending: false })
        .limit(limit);
      if (error) fail();
      return ((data ?? []) as unknown as Row[]).map(toSighting);
    },
    async prune(beforeIso) {
      const { error } = await client.from('badge_sightings').delete().lt('last_seen', beforeIso).or(`verified_at.is.null,verified_at.lt.${beforeIso}`);
      if (error) fail();
    },
  };
}
