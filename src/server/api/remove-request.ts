import { removalRepo, signerRepo, type RemovalRepo, type SignerRepo } from '../entities/signon-db/index.js';
import { waitUntil } from '@vercel/functions';
import { enqueueEmail } from '../features/outbox/index.js';
import { clientIp, requestRemoval, type EnqueueEmail } from '../features/signon/index.js';
import { loadBackendConfig } from '../shared/config/backend.js';
import { SignonError } from '../shared/errors/signon.js';
import { handle } from './http.js';
import { outboxDeps } from './outbox-deps.js';

export interface RemoveRequestHandlerDeps {
  loadConfig: () => { vercelEnv: string | undefined; turnstileSecret: string; hashSecret: Buffer };
  rateRepo: () => SignerRepo;
  repo: () => RemovalRepo;
  enqueue: EnqueueEmail;
  fetchFn: typeof fetch;
  now: () => Date;
  /** Runs work after the response has gone out (Vercel's `waitUntil`). */
  after: (work: Promise<void>) => void;
}

/**
 * POST /api/remove-request. Always 202 `{ status: 'check-email' }`, signed up or not. Counted in its own rate-limit bucket.
 * The lookup, token and email happen after the response is sent, and their errors are logged (request id and code only) and
 * never change it, so the answer and its timing do not say who has signed. Write endpoints answer 503 outside production.
 */
export function removeRequestHandler(deps: RemoveRequestHandlerDeps): (req: Request) => Promise<Response> {
  return handle(async (req, { requestId }) => {
    const config = deps.loadConfig();
    if (config.vercelEnv !== 'production') throw new SignonError('unavailable', 'not production');
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      throw new SignonError('bad-request');
    }
    const work = await requestRemoval(body, clientIp(req.headers), { config, rateRepo: deps.rateRepo(), repo: deps.repo(), enqueue: deps.enqueue, fetchFn: deps.fetchFn, now: deps.now });
    deps.after(
      work().catch((err: unknown) => {
        console.error(JSON.stringify({ requestId, code: err instanceof SignonError ? err.code : 'unavailable' }));
      }),
    );
    return Response.json({ status: 'check-email' }, { status: 202 });
  });
}

export const removeRequestRoute = removeRequestHandler({
  loadConfig: () => loadBackendConfig(),
  rateRepo: signerRepo,
  repo: removalRepo,
  enqueue: (kind, signerId, to, token) => enqueueEmail(outboxDeps(), kind, signerId, to, token),
  fetchFn: (...args) => fetch(...args),
  now: () => new Date(),
  after: (work) => waitUntil(work),
});
