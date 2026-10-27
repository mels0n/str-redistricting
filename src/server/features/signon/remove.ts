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

export interface RemoveRequestDeps {
  config: { turnstileSecret: string; hashSecret: Buffer };
  rateRepo: SignerRepo;
  repo: RemovalRepo;
  enqueue: EnqueueEmail;
  fetchFn: typeof fetch;
  now: () => Date;
}

/**
 * Asks for a removal link. The caller gets the same answer whether or not the email is signed up. Both paths make a token,
 * hash it and look the row up; only a found row stores the hash and queues the email.
 */
export async function requestRemoval(body: unknown, ip: string, deps: RemoveRequestDeps): Promise<void> {
  const parsed = RemoveRequestSchema.safeParse(body);
  if (!parsed.success) throw new SignonError('bad-request');
  const { email, turnstileToken } = parsed.data;
  const { config } = deps;
  await verifyTurnstile(turnstileToken, config.turnstileSecret, ip, deps.fetchFn);
  await checkRateLimit(deps.rateRepo, hashIp(`remove:${ip}`, config.hashSecret), deps.now());

  const token = newToken();
  const signer = await deps.repo.setRemoveToken(hashEmail(email, config.hashSecret), hashToken(token));
  if (signer) await deps.enqueue('remove', signer.id, email, token);
}

/** Deletes the signer who holds the token. A used token finds no row, so it is invalid. */
export async function removeSigner(body: unknown, repo: RemovalRepo, now: Date): Promise<void> {
  const parsed = RemoveSchema.safeParse(body);
  if (!parsed.success || !TOKEN_PATTERN.test(parsed.data.token)) throw new SignonError('token-invalid');
  const row = await repo.findByRemoveTokenHash(hashToken(parsed.data.token));
  if (!row) throw new SignonError('token-invalid');
  if (row.expiresAt !== null && new Date(row.expiresAt).getTime() < now.getTime()) throw new SignonError('token-expired');
  if (!(await repo.deleteSigner(row.id))) throw new SignonError('token-invalid');
}
