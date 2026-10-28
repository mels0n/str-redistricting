import { timingSafeEqual } from 'node:crypto';
import { signerRepo, type SignerRepo } from '../entities/signon-db/index.js';
import { drainOutbox, type OutboxDeps } from '../features/outbox/index.js';
import { maybeCleanup } from '../features/signon/index.js';
import { loadBackendConfig } from '../shared/config/backend.js';
import { SignonError } from '../shared/errors/signon.js';
import { checkBadgesNow } from './badge-check.js';
import { handle } from './http.js';
import { outboxDeps } from './outbox-deps.js';

export interface CronDrainDeps {
  /** The bearer secret Vercel sends to cron invocations; undefined when it is not configured. */
  cronSecret: () => string | undefined;
  outbox: () => OutboxDeps;
  loadConfig: () => { vercelEnv: string | undefined };
  repo: () => SignerRepo;
  now: () => Date;
  /** The daily badge check, run after the drain. Absent in tests that do not cover it. */
  checkBadges?: () => Promise<void>;
}

function bearerMatches(header: string | null, secret: string): boolean {
  const given = Buffer.from(header ?? '');
  const want = Buffer.from(`Bearer ${secret}`);
  return given.length === want.length && timingSafeEqual(given, want);
}

/** GET /api/cron-drain: sends what today's quota allows from the waiting emails. Answers 401 without the cron bearer token and 503 outside production. */
export function cronDrainHandler(deps: CronDrainDeps): (req: Request) => Promise<Response> {
  return handle(async (req) => {
    const secret = deps.cronSecret();
    if (!secret || !bearerMatches(req.headers.get('authorization'), secret)) return Response.json({ error: 'unauthorized' }, { status: 401 });
    if (deps.loadConfig().vercelEnv !== 'production') throw new SignonError('unavailable', 'not production');
    const outbox = deps.outbox();
    const drained = await drainOutbox(outbox, outbox.config.emailDailyCap);
    // Housekeeping rides on the daily call so it still happens when nobody signs. It never changes the answer.
    await maybeCleanup(deps.repo(), deps.now()).catch(() => undefined);
    await deps.checkBadges?.().catch(() => undefined);
    return Response.json(drained);
  });
}

export const cronDrainRoute = cronDrainHandler({
  cronSecret: () => loadBackendConfig().cronSecret,
  outbox: outboxDeps,
  loadConfig: () => loadBackendConfig(),
  repo: signerRepo,
  now: () => new Date(),
  checkBadges: checkBadgesNow,
});
