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
  /** Runs work after the response is sent (`waitUntil` in the route). Without it, enqueueEmail does the send before it returns. */
  after?: (task: Promise<unknown>) => void;
}

/**
 * - `sent`: the provider accepted it and the row is marked sent.
 * - `failed`: the send failed; the slot is back and the attempt is counted.
 * - `rejected`: the provider refused the address for good (400 or 422). A confirmation's signer is deleted; a removal row is marked failed.
 * - `skipped`: the row was gone or replaced; the slot is back.
 */
export type SendResult = 'sent' | 'failed' | 'rejected' | 'skipped';

/** One line per failed send, by row id only: never the address, the token or the provider's body. */
function logFailure(row: OutboxRow, cause: number | 'network' | 'unseal', final: boolean, errorName?: string): void {
  console.error(JSON.stringify({ event: 'email-send-failed', rowId: row.id, kind: row.kind, status: cause, ...(errorName && { error: errorName }), attempt: row.attempts + 1, final }));
  // A rejected key or sender means every send will fail until it is fixed.
  if (cause === 401 || cause === 403) console.error(JSON.stringify({ event: 'email-send-auth-rejected', rowId: row.id, status: cause }));
}

const SAFE_NAME = /^[a-z][a-z0-9_]{0,63}$/;
const RECIPIENT_WORDS = /\bto\b/i;
const ADDRESS_WORDS = /(invalid|not valid|address|email)/i;
const NOT_THE_RECIPIENT = /(\bfrom\b|subject|html|\btext\b|reply[_ -]?to|api key|domain)/i;

/** What Resend said went wrong: its error `name` (only a plain identifier is kept) and whether the message is about the recipient address. */
async function readRefusal(res: Response): Promise<{ name: string | undefined; aboutRecipient: boolean }> {
  try {
    const body = (await res.json()) as { name?: unknown; message?: unknown };
    const name = typeof body.name === 'string' && SAFE_NAME.test(body.name) ? body.name : undefined;
    const message = typeof body.message === 'string' ? body.message : '';
    // Permanent for this address only when it is a validation error that clearly names the recipient. A problem with the
    // sender, subject or body is the same for every request and says nothing about this address.
    const validation = name !== undefined && (name.includes('validation') || name.includes('invalid_to'));
    const aboutRecipient = validation && RECIPIENT_WORDS.test(message) && ADDRESS_WORDS.test(message) && !NOT_THE_RECIPIENT.test(message);
    return { name, aboutRecipient };
  } catch {
    return { name: undefined, aboutRecipient: false };
  }
}

/** Sends one queued row. The caller has already taken a slot. */
export async function sendRow(deps: OutboxDeps, listed: OutboxRow): Promise<SendResult> {
  const { repo, config } = deps;
  // The row may have been replaced (the signer signed again) or finished since it was listed: send what is stored now.
  let row: OutboxRow | null;
  try {
    row = await repo.getQueued(listed.id);
  } catch (err) {
    // The caller already took a slot; a failed read must not use it up.
    await repo.releaseSlot(listed.kind).catch(() => undefined);
    throw err;
  }
  if (!row) {
    await repo.releaseSlot(listed.kind);
    return 'skipped';
  }
  let status: number | 'network' | 'unseal' = 'network';
  let refusal: { name: string | undefined; aboutRecipient: boolean } = { name: undefined, aboutRecipient: false };
  try {
    let to: string;
    let token: string;
    try {
      to = open(row.toEnc, config.encryptionKey);
      token = open(row.tokenEnc, config.encryptionKey);
    } catch {
      status = 'unseal';
      throw new Error('unseal');
    }
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
    if (res.ok) {
      await repo.markSent(row);
      return 'sent';
    }
    status = res.status;
    refusal = await readRefusal(res);
  } catch (err) {
    // A database failure after the provider accepted the mail must not be counted as a send failure.
    if (status === 'network' && err instanceof Error && err.message === 'database error') throw err;
  }
  await repo.releaseSlot(row.kind);
  if ((status === 400 || status === 422) && refusal.aboutRecipient) {
    // The provider refused this recipient address for good, so retrying cannot help.
    logFailure(row, status, true, refusal.name);
    if (row.kind === 'confirm') await repo.deletePendingSigner(row.signerId);
    else await repo.recordFailure(row, 1);
    return 'rejected';
  }
  logFailure(row, status, row.attempts + 1 >= MAX_ATTEMPTS, refusal.name);
  await repo.recordFailure(row, MAX_ATTEMPTS);
  return 'failed';
}
