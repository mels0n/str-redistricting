import { timingSafeEqual } from 'node:crypto';
import { drainOutbox, type OutboxDeps } from '../features/outbox/index.js';
import { loadBackendConfig } from '../shared/config/backend.js';
import { handle } from './http.js';
import { outboxDeps } from './outbox-deps.js';

export interface CronDrainDeps {
  /** The bearer secret Vercel sends to cron invocations; undefined when it is not configured. */
  cronSecret: () => string | undefined;
  outbox: () => OutboxDeps;
}

function bearerMatches(header: string | null, secret: string): boolean {
  const given = Buffer.from(header ?? '');
  const want = Buffer.from(`Bearer ${secret}`);
  return given.length === want.length && timingSafeEqual(given, want);
}

/** GET /api/cron-drain: sends what today's quota allows from the waiting emails. Answers 401 without the cron bearer token. */
export function cronDrainHandler(deps: CronDrainDeps): (req: Request) => Promise<Response> {
  return handle(async (req) => {
    const secret = deps.cronSecret();
    if (!secret || !bearerMatches(req.headers.get('authorization'), secret)) return Response.json({ error: 'unauthorized' }, { status: 401 });
    const outbox = deps.outbox();
    return Response.json(await drainOutbox(outbox, outbox.config.emailDailyCap));
  });
}

export const cronDrainRoute = cronDrainHandler({ cronSecret: () => loadBackendConfig().cronSecret, outbox: outboxDeps });
