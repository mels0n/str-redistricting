import type { SignerRepo } from '../../entities/signon-db/index.js';
import { SignonError } from '../../shared/errors/signon.js';

export const RATE_LIMIT_PER_HOUR = 5;

/** Refuses the attempt after 5 earlier ones from this hashed address in the last hour; otherwise records it. */
export async function checkRateLimit(repo: SignerRepo, ipHash: string, now: Date): Promise<void> {
  const since = new Date(now.getTime() - 3_600_000).toISOString();
  if ((await repo.countAttempts(ipHash, since)) >= RATE_LIMIT_PER_HOUR) throw new SignonError('rate-limit');
  await repo.recordAttempt(ipHash);
}
