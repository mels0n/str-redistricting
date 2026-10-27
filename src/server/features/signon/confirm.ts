import type { SignerRepo } from '../../entities/signon-db/index.js';
import { SignonError } from '../../shared/errors/signon.js';
import { hashToken, TOKEN_PATTERN } from './hash.js';

/** Confirms the signer who holds the token and returns their state. A second click finds the confirmed row and changes nothing. */
export async function confirm(token: string | null, repo: SignerRepo, now: Date): Promise<{ state: string }> {
  if (!token || !TOKEN_PATTERN.test(token)) throw new SignonError('token-invalid');
  const row = await repo.findByTokenHash(hashToken(token));
  if (!row) throw new SignonError('token-invalid');
  if (row.status === 'confirmed') return { state: row.state };
  if (row.tokenExpiresAt !== null && new Date(row.tokenExpiresAt).getTime() < now.getTime()) throw new SignonError('token-expired');
  await repo.confirm(row.id, now.toISOString());
  return { state: row.state };
}
