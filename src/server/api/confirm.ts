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

const redirect = (location: string): Response => new Response(null, { status: 303, headers: { location } });

/** GET /api/confirm?token=<hex>. Sends the browser to the signer's state, or to the home page when the link has expired. */
export function confirmHandler(deps: ConfirmHandlerDeps): (req: Request) => Promise<Response> {
  return handle(async (req) => {
    if (deps.loadConfig().vercelEnv !== 'production') throw new SignonError('unavailable', 'not production');
    try {
      const { state } = await confirm(new URL(req.url).searchParams.get('token'), deps.repo(), deps.now());
      return redirect(`/${state}?signed=1`);
    } catch (err) {
      if (err instanceof SignonError && err.code === 'token-expired') return redirect('/?signed=expired');
      throw err;
    }
  });
}

export const confirmRoute = confirmHandler({ loadConfig: () => loadBackendConfig(), repo: signerRepo, now: () => new Date() });
