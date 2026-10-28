import { WebsitesFileSchema, type WebsitesFile } from './list.js';

const TTL_MS = 10 * 60_000;
let cached: { at: number; key: string; value: Promise<WebsitesFile> } | null = null;

/** Forgets the cached file (tests). */
export function clearWebsitesCache(): void {
  cached = null;
}

/**
 * The representatives' websites map, read from the site's own published file and kept for 10 minutes per instance. A file that is
 * missing or does not match the schema gives an empty map: sites are still listed, only without a name.
 */
export function loadWebsites(origin: string, fetchFn: typeof fetch = fetch, now: () => number = Date.now): Promise<WebsitesFile> {
  if (cached && cached.key === origin && now() - cached.at < TTL_MS) return cached.value;
  const value = (async (): Promise<WebsitesFile> => {
    try {
      const res = await fetchFn(`${origin}/data/reps/websites.json`, { signal: AbortSignal.timeout(4000) });
      if (!res.ok) return {};
      const parsed = WebsitesFileSchema.safeParse(await res.json());
      return parsed.success ? parsed.data : {};
    } catch {
      return {};
    }
  })();
  cached = { at: now(), key: origin, value };
  return value;
}
