import { removalRepo, signerRepo, type RemovalRepo, type SignerRepo } from '../entities/signon-db/index.js';
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
}

/** POST /api/remove-request. Always 202 `{ status: 'check-email' }`, signed up or not. Counted in its own rate-limit bucket. Write endpoints answer 503 outside production. */
export function removeRequestHandler(deps: RemoveRequestHandlerDeps): (req: Request) => Promise<Response> {
  return handle(async (req) => {
    const config = deps.loadConfig();
    if (config.vercelEnv !== 'production') throw new SignonError('unavailable', 'not production');
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      throw new SignonError('bad-request');
    }
    await requestRemoval(body, clientIp(req.headers), { config, rateRepo: deps.rateRepo(), repo: deps.repo(), enqueue: deps.enqueue, fetchFn: deps.fetchFn, now: deps.now });
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
});
