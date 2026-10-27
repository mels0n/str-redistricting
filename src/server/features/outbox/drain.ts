import { sendRow, type OutboxDeps } from './send.js';

const PAGE = 500;
/** Stop after this many sends in a row fail, so an outage at the mail provider does not use up every row's attempts. */
const MAX_CONSECUTIVE_FAILURES = 3;

/** Sends waiting rows (removals first, then oldest) for as long as today's quota has room. Removals stop at their share of the day (half the cap); confirmations carry on past them. */
export async function drainOutbox(deps: OutboxDeps, cap: number): Promise<{ sent: number; left: number }> {
  const { repo } = deps;
  const rows = await repo.listQueued(PAGE);
  let sent = 0;
  let failures = 0;
  let removalsCapped = false;
  for (const row of rows) {
    if (row.kind === 'remove' && removalsCapped) continue;
    if (!(await repo.claimSlot(cap, row.kind))) {
      // A removal refused may only mean its share is used; a confirmation refused means the day is full.
      if (row.kind === 'remove') {
        removalsCapped = true;
        continue;
      }
      break;
    }
    const result = await sendRow(deps, row);
    if (result === 'sent') {
      sent++;
      failures = 0;
    } else if (result === 'failed' && ++failures >= MAX_CONSECUTIVE_FAILURES) {
      break;
    }
  }
  return { sent, left: await repo.countQueued() };
}
