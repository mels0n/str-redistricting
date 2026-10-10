/** A HEAD or probe request is abandoned after this long. */
export const HEAD_TIMEOUT_MS = 30_000;

/** Sent on every request to the Census Bureau, so the operator can see who is asking. */
export const CENSUS_USER_AGENT = 'str-redistricting (+https://github.com/mels0n/str-redistricting)';
/** The longest a server's Retry-After is honored. */
export const MAX_RETRY_AFTER_MS = 60_000;

/** How long to wait before a retry: the backoff, or longer when the server asked for more. */
export function retryWaitMs(backoffMs: number, serverAskedMs: number | undefined): number {
  return Math.max(backoffMs, serverAskedMs ?? 0);
}

/** The wait a 429 or 503 asks for in `Retry-After` (whole seconds), capped at MAX_RETRY_AFTER_MS; undefined when absent, or an HTTP date. */
export function retryAfterMs(res: Response): number | undefined {
  if (res.status !== 429 && res.status !== 503) return undefined;
  const raw = res.headers.get('retry-after');
  if (raw === null || !/^\d+$/.test(raw.trim())) return undefined;
  return Math.min(Number(raw.trim()) * 1000, MAX_RETRY_AFTER_MS);
}
