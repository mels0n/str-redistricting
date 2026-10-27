import { signerRepo, type SignerRepo } from '../entities/signon-db/index.js';
import { enqueueEmail } from '../features/outbox/index.js';
import { clientIp, sign, type EnqueueEmail, type SignConfig } from '../features/signon/index.js';
import { loadBackendConfig } from '../shared/config/backend.js';
import { SignonError } from '../shared/errors/signon.js';
import { handle } from './http.js';

export interface SignHandlerDeps {
  loadConfig: () => SignConfig & { vercelEnv: string | undefined };
  repo: () => SignerRepo;
  enqueue: EnqueueEmail;
  fetchFn: typeof fetch;
  now: () => Date;
}

/** POST /api/sign. Write endpoints answer 503 outside production. */
export function signHandler(deps: SignHandlerDeps): (req: Request) => Promise<Response> {
  return handle(async (req) => {
    const config = deps.loadConfig();
    if (config.vercelEnv !== 'production') throw new SignonError('unavailable', 'not production');
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      throw new SignonError('bad-request');
    }
    const result = await sign(body, clientIp(req.headers), { config, repo: deps.repo(), enqueue: deps.enqueue, fetchFn: deps.fetchFn, now: deps.now });
    return Response.json(result, { status: 202 });
  });
}

export const signRoute = signHandler({
  loadConfig: () => loadBackendConfig(),
  repo: signerRepo,
  enqueue: enqueueEmail,
  fetchFn: (...args) => fetch(...args),
  now: () => new Date(),
});
