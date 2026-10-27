import { createHash } from 'node:crypto';
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
export async function sendRow(deps: OutboxDeps, listed: OutboxRow): Promise<boolean> {
  const { repo, config } = deps;
  // The row may have been replaced (the signer signed again) or finished since it was listed: send what is stored now.
  const row = await repo.getQueued(listed.id);
  if (!row) {
    await repo.releaseSlot();
    return false;
  }
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
        // Same key only for the same row, attempt and token (so a lost database write cannot send the email twice);
        // a replaced token or a later attempt is a different request and gets a different key.
        'idempotency-key': `outbox-${row.id}-${row.attempts}-${createHash('sha256').update(token).digest('hex').slice(0, 16)}`,
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
