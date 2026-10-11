import type { z } from 'zod';
import { DataLoadError, DataShapeError } from '../lib/errors';

/** A data file that has not arrived after this long counts as a failed load. */
const TIMEOUT_MS = 60_000;

/** The cache keeps this many URLs, dropping the oldest first. */
const MAX_ENTRIES = 32;

const cache = new Map<string, Promise<unknown>>();

async function fetchRaw(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    let res: Response;
    try {
      res = await fetch(url, { signal: controller.signal });
    } catch (cause) {
      throw new DataLoadError(url, null, { cause, timedOut: controller.signal.aborted });
    }
    if (!res.ok) throw new DataLoadError(url, res.status);
    try {
      return (await res.json()) as unknown;
    } catch (cause) {
      // A body cut off by the timeout or a dropped connection is a load failure, not bad data.
      if (controller.signal.aborted) throw new DataLoadError(url, null, { cause, timedOut: true });
      if (cause instanceof TypeError) throw new DataLoadError(url, null, { cause });
      throw new DataShapeError(url, 'not valid JSON');
    }
  } finally {
    window.clearTimeout(timer);
  }
}

/** Forgets every fetched file, so the next call for any URL fetches again. */
export function clearFetchCache(): void {
  cache.clear();
}

/**
 * Fetches a JSON file once and validates it against a schema at the boundary.
 * Repeated calls for the same URL share one request; a failed request is
 * forgotten so a retry fetches again.
 */
export function fetchJson<S extends z.ZodType>(url: string, schema: S): Promise<z.infer<S>> {
  let raw = cache.get(url);
  if (!raw) {
    const fresh = fetchRaw(url);
    raw = fresh;
    // Only forget the entry this request made; the cache may have been cleared and refilled since.
    fresh.catch(() => {
      if (cache.get(url) === fresh) cache.delete(url);
    });
    if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
    cache.set(url, fresh);
  }
  const current = raw;
  return current.then((data) => {
    const parsed = schema.safeParse(data);
    if (!parsed.success) {
      // Drop the bad copy so a retry fetches again.
      if (cache.get(url) === current) cache.delete(url);
      const issue = parsed.error.issues[0];
      throw new DataShapeError(url, issue ? `${issue.path.join('.')}: ${issue.message}` : 'invalid');
    }
    return parsed.data as z.infer<S>;
  });
}
