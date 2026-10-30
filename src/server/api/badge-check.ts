import { badgeRepo } from '../entities/badge-db/index.js';
import { db } from '../entities/signon-db/index.js';
import { RUN_BUDGET_MS, runBadgeChecks } from '../features/badge/index.js';
import { loadBackendConfig } from '../shared/config/backend.js';

/** Runs the daily badge check on the live table, which stops starting new sites RUN_BUDGET_MS after `startedAt` (the cron call's start). It never throws: the cron answer is about the email drain. */
export async function checkBadgesNow(startedAt: number): Promise<void> {
  try {
    await runBadgeChecks({ repo: badgeRepo(db()), siteHost: new URL(loadBackendConfig().siteOrigin).hostname, now: () => new Date(), deadline: startedAt + RUN_BUDGET_MS });
  } catch {
    console.error(JSON.stringify({ code: 'badge-check' }));
  }
}
