import type { SignerRepo } from '../../entities/signon-db/index.js';
import { SignonError } from '../../shared/errors/signon.js';

export const RATE_LIMIT_PER_HOUR = 5;

/** Records the attempt, then counts the last hour including it, and refuses from the 6th. Recording first keeps parallel requests from all passing a count. */
export async function checkRateLimit(repo: SignerRepo, ipHash: string, now: Date): Promise<void> {
  await repo.recordAttempt(ipHash);
  const since = new Date(now.getTime() - 3_600_000).toISOString();
  if ((await repo.countAttempts(ipHash, since)) > RATE_LIMIT_PER_HOUR) throw new SignonError('rate-limit');
}
