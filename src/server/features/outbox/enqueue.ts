import { SignonError } from '../../shared/errors/signon.js';

export type EmailKind = 'confirm' | 'remove';

/** Placeholder until the outbox table and the drain exist (next commit): sign-up answers 503 rather than sending unmetered mail. */
export async function enqueueEmail(_kind: EmailKind, _signerId: string, _to: string, _token: string): Promise<{ queued: boolean }> {
  throw new SignonError('unavailable', 'outbox not available');
}
