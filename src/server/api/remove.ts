import { removalRepo, type RemovalRepo } from '../entities/signon-db/index.js';
import { removeSigner } from '../features/signon/index.js';
import { loadBackendConfig } from '../shared/config/backend.js';
import { SignonError } from '../shared/errors/signon.js';
import { handle } from './http.js';

export interface RemoveHandlerDeps {
  loadConfig: () => { vercelEnv: string | undefined };
  repo: () => RemovalRepo;
  now: () => Date;
}

/** POST /api/remove. Deletes the signer who holds the token. POST only, from a button: a GET from an email scanner must never delete anyone. */
export function removeHandler(deps: RemoveHandlerDeps): (req: Request) => Promise<Response> {
  return handle(async (req) => {
    if (req.method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'POST' } });
    if (deps.loadConfig().vercelEnv !== 'production') throw new SignonError('unavailable', 'not production');
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      throw new SignonError('bad-request');
    }
    await removeSigner(body, deps.repo(), deps.now());
    return Response.json({ status: 'removed' });
  });
}

export const removeRoute = removeHandler({ loadConfig: () => loadBackendConfig(), repo: removalRepo, now: () => new Date() });
