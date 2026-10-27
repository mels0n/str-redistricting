import type { OutboxRepo, OutboxRow } from '../../entities/signon-db/index.js';
import { open } from '../../shared/crypto/index.js';
import { linkFor, renderEmail } from './templates.js';

export const MAX_ATTEMPTS = 3;
const RESEND_URL = 'https://api.resend.com/emails';

export interface OutboxConfig {
  resendApiKey: string;
  from: string;
  siteOrigin: string;
  encryptionKey: Buffer;
  emailDailyCap: number;
}

export interface OutboxDeps {
  repo: OutboxRepo;
  config: OutboxConfig;
  fetchFn: typeof fetch;
}

/**
 * Sends one queued row. The caller has already taken a slot. On success the row is marked sent (which drops the sealed
 * address and token and starts the signer's 48 hours). On any failure the slot is given back and the attempt is counted.
 */
export async function sendRow(deps: OutboxDeps, row: OutboxRow): Promise<boolean> {
  const { repo, config } = deps;
  let accepted = false;
  try {
    const to = open(row.toEnc, config.encryptionKey);
    const token = open(row.tokenEnc, config.encryptionKey);
    const mail = renderEmail(row.kind, linkFor(row.kind, token, config.siteOrigin), config.siteOrigin);
    const res = await deps.fetchFn(RESEND_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.resendApiKey}`,
        'content-type': 'application/json',
        // Same key for a retry of the same attempt, so a lost database write cannot send the email twice.
        'idempotency-key': `outbox-${row.id}-${row.attempts}`,
      },
      body: JSON.stringify({ from: config.from, to: [to], subject: mail.subject, text: mail.text }),
      signal: AbortSignal.timeout(15_000),
    });
    accepted = res.ok;
  } catch {
    accepted = false;
  }
  if (!accepted) {
    await repo.releaseSlot();
    await repo.recordFailure(row, MAX_ATTEMPTS);
    return false;
  }
  await repo.markSent(row.id);
  return true;
}
