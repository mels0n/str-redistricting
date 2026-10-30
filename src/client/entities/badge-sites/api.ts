import { BadgeSitesSchema, type BadgeSite } from './model';

const TIMEOUT_MS = 4000;
let cached: Promise<BadgeSite[] | null> | null = null;

/** The sites that show the badge; null on any error or after 4 seconds. It never throws. One request is shared by every caller on the page. */
export function loadBadgeSites(): Promise<BadgeSite[] | null> {
  cached ??= (async () => {
    try {
      const res = await fetch('/api/badge-sites', { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) return null;
      const parsed = BadgeSitesSchema.safeParse(await res.json());
      return parsed.success ? parsed.data.sites : null;
    } catch {
      return null;
    }
  })();
  // A failure is not kept, so the next look tries again.
  void cached.then((v) => {
    if (v === null) cached = null;
  });
  return cached;
}

/** Forgets the shared answer (tests). */
export function resetBadgeSites(): void {
  cached = null;
}
