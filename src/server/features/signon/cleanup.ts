import type { SignerRepo } from '../../entities/signon-db/index.js';

const EVERY_MS = 10 * 60_000;
const DAY_MS = 86_400_000;
let lastRun = 0;

/** Lets the next call run (tests). */
export function resetCleanup(): void {
  lastRun = 0;
}

/**
 * Housekeeping, at most once per 10 minutes per instance and never failing the caller: rate-limit rows older than
 * 24 hours go, and so do pending signers whose confirmation link was sent and expired over 7 days ago, and pending signers
 * last signed up over 9 days ago whose email never went out and is no longer waiting. A signer whose email is still queued
 * is kept however old.
 */
export async function maybeCleanup(repo: SignerRepo, now: Date): Promise<void> {
  if (now.getTime() - lastRun < EVERY_MS) return;
  lastRun = now.getTime();
  try {
    const t = now.getTime();
    await repo.cleanup(new Date(t - DAY_MS).toISOString(), new Date(t - 7 * DAY_MS).toISOString(), new Date(t - 9 * DAY_MS).toISOString());
  } catch {
    // Best effort: the next run tries again.
  }
}
