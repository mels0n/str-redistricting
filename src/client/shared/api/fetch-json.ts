import type { z } from 'zod';
import { DataLoadError, DataShapeError } from '../lib/errors';

const cache = new Map<string, Promise<unknown>>();

/**
 * Fetches a JSON file once and validates it against a schema at the boundary.
 * Repeated calls for the same URL share one request.
 */
export function fetchJson<S extends z.ZodType>(url: string, schema: S): Promise<z.infer<S>> {
  let raw = cache.get(url);
  if (!raw) {
    raw = fetch(url)
      .catch((cause: unknown) => {
        throw new DataLoadError(url, null, { cause });
      })
      .then(async (res) => {
        if (!res.ok) throw new DataLoadError(url, res.status);
        try {
          return (await res.json()) as unknown;
        } catch {
          throw new DataShapeError(url, 'not valid JSON');
        }
      });
    raw.catch(() => cache.delete(url));
    cache.set(url, raw);
  }
  return raw.then((data) => {
    const parsed = schema.safeParse(data);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new DataShapeError(url, issue ? `${issue.path.join('.')}: ${issue.message}` : 'invalid');
    }
    return parsed.data as z.infer<S>;
  });
}
