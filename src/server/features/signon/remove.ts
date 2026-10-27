import { z } from 'zod';
import type { RemovalRepo, SignerRepo } from '../../entities/signon-db/index.js';
import { SignonError } from '../../shared/errors/signon.js';
import { hashEmail, hashIp, hashToken, newToken, TOKEN_PATTERN } from './hash.js';
import { checkRateLimit } from './rate-limit.js';
import { verifyTurnstile } from './turnstile.js';
import type { EnqueueEmail } from './sign.js';

export const RemoveRequestSchema = z.strictObject({
  email: z.email().max(254),
  turnstileToken: z.string().min(1).max(2048),
});
export const RemoveSchema = z.strictObject({ token: z.string().max(200) });

/** A signer's removal token is not replaced, and no email is queued, for this long after it was made. */
export const REMOVE_COOLDOWN_MS = 30 * 60_000;
/** A token whose email never went out (so it has no expiry) is refused once it is this old. */
export const REMOVE_UNSENT_MAX_AGE_MS = 7 * 24 * 3_600_000;

export interface RemoveRequestDeps {
  config: { turnstileSecret: string; hashSecret: Buffer };
  rateRepo: SignerRepo;
  repo: RemovalRepo;
  enqueue: EnqueueEmail;
  fetchFn: typeof fetch;
  now: () => Date;
}

/**
 * Asks for a removal link. It checks the request, then returns the rest of the work as a function for the caller to run
 * after it has answered: the lookup, the token and the email. Whether the email is signed up, in its cooldown, or the
 * database or mail provider is failing, the caller sees the same thing. The caller must catch what the function throws.
 */
export async function requestRemoval(body: unknown, ip: string, deps: RemoveRequestDeps): Promise<() => Promise<void>> {
  const parsed = RemoveRequestSchema.safeParse(body);
  if (!parsed.success) throw new SignonError('bad-request');
  const { email, turnstileToken } = parsed.data;
  const { config } = deps;
  await verifyTurnstile(turnstileToken, config.turnstileSecret, ip, deps.fetchFn);
  await checkRateLimit(deps.rateRepo, hashIp(ip, config.hashSecret, 'remove'), deps.now());

  return async () => {
    const now = deps.now();
    const token = newToken();
    // Inside the cooldown (or for an unknown email) nothing is stored and nothing is queued.
    const signer = await deps.repo.setRemoveToken(hashEmail(email, config.hashSecret), hashToken(token), now.toISOString(), new Date(now.getTime() - REMOVE_COOLDOWN_MS).toISOString());
    if (signer) await deps.enqueue('remove', signer.id, email, token);
  };
}

/** Deletes the signer who holds the token. A used token finds no row, so it is invalid. */
export async function removeSigner(body: unknown, repo: RemovalRepo, now: Date): Promise<void> {
  const parsed = RemoveSchema.safeParse(body);
  if (!parsed.success || !TOKEN_PATTERN.test(parsed.data.token)) throw new SignonError('token-invalid');
  const row = await repo.findByRemoveTokenHash(hashToken(parsed.data.token));
  if (!row) throw new SignonError('token-invalid');
  // No expiry yet means the email has not gone out; that does not last forever.
  const expired =
    row.expiresAt !== null ? new Date(row.expiresAt).getTime() < now.getTime() : row.setAt === null || new Date(row.setAt).getTime() < now.getTime() - REMOVE_UNSENT_MAX_AGE_MS;
  if (expired) throw new SignonError('token-expired');
  if (!(await repo.deleteSigner(row.id))) throw new SignonError('token-invalid');
}
