import { badgeRepo } from '../entities/badge-db/index.js';
import { db } from '../entities/signon-db/index.js';
import { runBadgeChecks } from '../features/badge/index.js';
import { loadBackendConfig } from '../shared/config/backend.js';

/** The time the daily check may use after the email drain; the function itself is allowed 60 seconds. */
export const BADGE_CHECK_BUDGET_MS = 35_000;

/** Runs the daily badge check on the live table. It never throws: the cron answer is about the email drain. */
export async function checkBadgesNow(): Promise<void> {
  try {
    await runBadgeChecks({ repo: badgeRepo(db()), siteHost: new URL(loadBackendConfig().siteOrigin).hostname, now: () => new Date(), deadline: Date.now() + BADGE_CHECK_BUDGET_MS });
  } catch {
    console.error(JSON.stringify({ code: 'badge-check' }));
  }
}
