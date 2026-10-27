import { signerRepo, type SignerRepo } from '../entities/signon-db/index.js';
import { enqueueEmail, wouldQueue } from '../features/outbox/index.js';
import { clientIp, maybeCleanup, sign, type EnqueueEmail, type SignConfig } from '../features/signon/index.js';
import { loadBackendConfig } from '../shared/config/backend.js';
import { SignonError } from '../shared/errors/signon.js';
import { handle } from './http.js';
import { outboxDeps } from './outbox-deps.js';

export interface SignHandlerDeps {
  loadConfig: () => SignConfig & { vercelEnv: string | undefined };
  repo: () => SignerRepo;
  enqueue: EnqueueEmail;
  wouldQueue: () => Promise<boolean>;
  fetchFn: typeof fetch;
  now: () => Date;
}

/** POST /api/sign. Write endpoints answer 503 outside production. */
export function signHandler(deps: SignHandlerDeps): (req: Request) => Promise<Response> {
  return handle(async (req) => {
    const config = deps.loadConfig();
    if (config.vercelEnv !== 'production') throw new SignonError('unavailable', 'not production');
    await maybeCleanup(deps.repo(), deps.now());
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      throw new SignonError('bad-request');
    }
    const result = await sign(body, clientIp(req.headers), { config, repo: deps.repo(), enqueue: deps.enqueue, wouldQueue: deps.wouldQueue, fetchFn: deps.fetchFn, now: deps.now });
    return Response.json(result, { status: 202 });
  });
}

export const signRoute = signHandler({
  loadConfig: () => loadBackendConfig(),
  repo: signerRepo,
  enqueue: (kind, signerId, to, token) => enqueueEmail(outboxDeps(), kind, signerId, to, token),
  wouldQueue: () => wouldQueue(outboxDeps()),
  fetchFn: (...args) => fetch(...args),
  now: () => new Date(),
});
