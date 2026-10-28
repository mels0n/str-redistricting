import type { OutboxRow } from '../../entities/signon-db/index.js';
import { sendRow, type OutboxDeps } from './send.js';

const PAGE = 500;
/** Stop after this many sends in a row fail, so an outage at the mail provider does not use up every row's attempts. */
const MAX_CONSECUTIVE_FAILURES = 3;
/** Stop after this many address refusals in a row: a real bad address is rare, so a run of them means something else is wrong, and no more signers should be deleted. */
const MAX_CONSECUTIVE_REFUSALS = 3;

/**
 * Sends waiting rows for as long as today's quota has room: removals first, then confirmations, each oldest first.
 * Removals stop at their share of the day (half the cap, at least one); confirmations carry on past them.
 * `failed` counts sends that did not go out (including addresses the provider refused).
 */
export async function drainOutbox(deps: OutboxDeps, cap: number): Promise<{ sent: number; failed: number; left: number }> {
  const { repo } = deps;
  let sent = 0;
  let failed = 0;
  let consecutive = 0;
  let refusals = 0;
  let stop = false;

  const run = async (rows: OutboxRow[]): Promise<void> => {
    for (const row of rows) {
      if (stop) return;
      // A removal refused may only mean its share is used; a confirmation refused means the day is full.
      if (!(await repo.claimSlot(cap, row.kind))) return;
      const result = await sendRow(deps, row);
      if (result === 'rejected') {
        failed++;
        consecutive = 0;
        if (++refusals >= MAX_CONSECUTIVE_REFUSALS) {
          console.error(JSON.stringify({ event: 'email-drain-stopped', reason: 'consecutive-address-refusals', refusals }));
          stop = true;
        }
        continue;
      }
      refusals = 0;
      if (result === 'sent') {
        sent++;
        consecutive = 0;
      } else if (result === 'failed') {
        failed++;
        if (++consecutive >= MAX_CONSECUTIVE_FAILURES) stop = true;
      }
    }
  };

  // Each kind has its own list, so a long run of removals can never hide the confirmations behind it.
  await run(await repo.listQueued(PAGE, 'remove'));
  await run(await repo.listQueued(PAGE, 'confirm'));
  return { sent, failed, left: await repo.countQueued() };
}
