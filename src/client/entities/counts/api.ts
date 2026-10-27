import type { Office } from '../../shared';
import { DistrictCountsSchema, type DistrictCounts } from './model';

const TIMEOUT_MS = 4000;

/** Signer and ask counts; null on any error or after 4 seconds. It never throws, so a failure leaves the page as it was. */
export async function loadCounts(state?: string): Promise<DistrictCounts | null> {
  try {
    const url = state ? `/api/counts?state=${encodeURIComponent(state)}` : '/api/counts';
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return null;
    const parsed = DistrictCountsSchema.safeParse(await res.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

const asked = new Set<string>();

/** Tells the counter someone used a letter for this office. At most once per office per page load; fire and forget. */
export function recordAsk(key: string, office: Office): void {
  if (asked.has(key)) return;
  asked.add(key);
  try {
    void fetch('/api/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key, office }), keepalive: true }).catch(() => undefined);
  } catch {
    /* the count is a courtesy */
  }
}

/** Forgets what was sent (tests). */
export function resetAsks(): void {
  asked.clear();
}
