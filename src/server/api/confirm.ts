import { signerRepo, type SignerRepo } from '../entities/signon-db/index.js';
import { confirm } from '../features/signon/index.js';
import { loadBackendConfig } from '../shared/config/backend.js';
import { SignonError } from '../shared/errors/signon.js';
import { handle } from './http.js';

export interface ConfirmHandlerDeps {
  loadConfig: () => { vercelEnv: string | undefined };
  repo: () => SignerRepo;
  now: () => Date;
}

/**
 * POST /api/confirm with `{ token }`. The email links to the /confirm page, whose script makes this call, so a mail scanner
 * that only fetches the link cannot confirm anyone: any other method answers 405 and changes nothing. Answers
 * `{ status: 'confirmed', state }` (again for a token already confirmed), 400 token-invalid or 410 token-expired.
 */
export function confirmHandler(deps: ConfirmHandlerDeps): (req: Request) => Promise<Response> {
  return handle(async (req) => {
    if (req.method !== 'POST') return Response.json({ error: 'method-not-allowed' }, { status: 405, headers: { allow: 'POST' } });
    if (deps.loadConfig().vercelEnv !== 'production') throw new SignonError('unavailable', 'not production');
    let token: string | null = null;
    try {
      const body: unknown = await req.json();
      if (typeof body === 'object' && body !== null && typeof (body as { token?: unknown }).token === 'string') token = (body as { token: string }).token;
    } catch {
      // A body that is not JSON has no token.
    }
    const { state } = await confirm(token, deps.repo(), deps.now());
    return Response.json({ status: 'confirmed', state });
  });
}

export const confirmRoute = confirmHandler({ loadConfig: () => loadBackendConfig(), repo: signerRepo, now: () => new Date() });
