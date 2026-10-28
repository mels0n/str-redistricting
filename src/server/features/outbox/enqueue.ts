import type { EmailKind } from '../../entities/signon-db/index.js';
import { seal } from '../../shared/crypto/index.js';
import { sendRow, type OutboxDeps } from './send.js';

export type { EmailKind };

/**
 * Queues an email and sends it at once only if nobody is waiting ahead of it and today's quota has room.
 * A person who signs today never jumps ahead of people already waiting. The address and token are stored sealed
 * and are dropped when the email goes out. All database writes happen before this returns; when the route gives an `after`
 * hook, only the call to the mail provider (and the bookkeeping after it) is deferred, and `queued: false` is returned once the
 * slot is taken. A deferred send that fails leaves the row queued for the daily job.
 */
export async function enqueueEmail(deps: OutboxDeps, kind: EmailKind, signerId: string, to: string, token: string): Promise<{ queued: boolean }> {
  const { repo, config } = deps;
  const row = await repo.upsertQueued(kind, signerId, seal(to, config.encryptionKey), seal(token, config.encryptionKey));
  if (await repo.hasQueuedAhead(row)) return { queued: true };
  if (!(await repo.claimSlot(config.emailDailyCap, kind))) return { queued: true };
  if (deps.after) {
    deps.after(
      sendRow(deps, row).then(
        () => undefined,
        () => console.error(JSON.stringify({ event: 'email-send-error', rowId: row.id })),
      ),
    );
    return { queued: false };
  }
  // The visitor is told to check their email either way. A refused address (the signer is gone) is not "in line" for a later day, so it is not reported as queued.
  const result = await sendRow(deps, row);
  return { queued: result !== 'sent' && result !== 'rejected' };
}

/** What a new confirmation email would get right now, without queuing or sending anything: waiting if people are in line or today's quota is spent. */
export async function wouldQueue(deps: OutboxDeps): Promise<boolean> {
  const { repo, config } = deps;
  return (await repo.countQueued()) > 0 || (await repo.quotaSpent(config.emailDailyCap));
}
