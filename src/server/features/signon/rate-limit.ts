import type { SignerRepo } from '../../entities/signon-db/index.js';
import { SignonError } from '../../shared/errors/signon.js';

export const RATE_LIMIT_PER_HOUR = 5;

/**
 * Refuses the 6th attempt in an hour (or the one after `limit`). It counts first and refuses without recording when the limit is already reached, so a
 * flood of refused requests does not grow the table; otherwise it records the attempt and counts again, so parallel requests
 * that all passed the first count cannot all get through.
 */
export async function checkRateLimit(repo: SignerRepo, ipHash: string, now: Date, limit: number = RATE_LIMIT_PER_HOUR): Promise<void> {
  const since = new Date(now.getTime() - 3_600_000).toISOString();
  if ((await repo.countAttempts(ipHash, since)) >= limit) throw new SignonError('rate-limit');
  await repo.recordAttempt(ipHash);
  if ((await repo.countAttempts(ipHash, since)) > limit) throw new SignonError('rate-limit');
}
