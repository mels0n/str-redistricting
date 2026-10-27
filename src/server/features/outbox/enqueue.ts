import type { EmailKind } from '../../entities/signon-db/index.js';
import { seal } from '../../shared/crypto/index.js';
import { sendRow, type OutboxDeps } from './send.js';

export type { EmailKind };

/**
 * Queues an email and sends it at once only if nobody is waiting ahead of it and today's quota has room.
 * A person who signs today never jumps ahead of people already waiting. The address and token are stored sealed
 * and are dropped when the email goes out.
 */
export async function enqueueEmail(deps: OutboxDeps, kind: EmailKind, signerId: string, to: string, token: string): Promise<{ queued: boolean }> {
  const { repo, config } = deps;
  const row = await repo.upsertQueued(kind, signerId, seal(to, config.encryptionKey), seal(token, config.encryptionKey));
  if (await repo.hasQueuedAhead(row)) return { queued: true };
  if (!(await repo.claimSlot(config.emailDailyCap))) return { queued: true };
  return { queued: !(await sendRow(deps, row)) };
}
