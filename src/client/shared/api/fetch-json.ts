import type { z } from 'zod';
import { DataLoadError, DataShapeError } from '../lib/errors';

/** A data file that has not arrived after this long counts as a failed load. */
const TIMEOUT_MS = 60_000;

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

/**
 * Fetches a JSON file once and validates it against a schema at the boundary.
 * Repeated calls for the same URL share one request; a failed request is
 * forgotten so a retry fetches again.
 */
export function fetchJson<S extends z.ZodType>(url: string, schema: S): Promise<z.infer<S>> {
  let raw = cache.get(url);
  if (!raw) {
    raw = fetchRaw(url);
    raw.catch(() => cache.delete(url));
    cache.set(url, raw);
  }
  return raw.then((data) => {
    const parsed = schema.safeParse(data);
    if (!parsed.success) {
      // Drop the bad copy so a retry fetches again.
      cache.delete(url);
      const issue = parsed.error.issues[0];
      throw new DataShapeError(url, issue ? `${issue.path.join('.')}: ${issue.message}` : 'invalid');
    }
    return parsed.data as z.infer<S>;
  });
}
