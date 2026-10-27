import { SignonError } from '../../shared/errors/signon.js';

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** Throws `bot-check` unless Cloudflare accepts the token. A network failure throws as unavailable. */
export async function verifyTurnstile(token: string, secret: string, ip: string, fetchFn: typeof fetch): Promise<void> {
  const body = new URLSearchParams({ secret, response: token });
  if (ip !== 'unknown') body.set('remoteip', ip);
  let ok = false;
  try {
    const res = await fetchFn(VERIFY_URL, { method: 'POST', body, signal: AbortSignal.timeout(10_000) });
    const json = (await res.json()) as { success?: unknown };
    ok = res.ok && json.success === true;
  } catch {
    throw new SignonError('unavailable', 'turnstile unreachable');
  }
  if (!ok) throw new SignonError('bot-check');
}
