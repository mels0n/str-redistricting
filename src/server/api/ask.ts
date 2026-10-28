import { countsRepo, signerRepo, type CountsRepo, type SignerRepo } from '../entities/signon-db/index.js';
import { AskRequestSchema, recordAsk } from '../features/counts/index.js';
import { checkRateLimit, clientIp, hashIp } from '../features/signon/index.js';
import { loadBackendConfig } from '../shared/config/backend.js';
import { SignonError } from '../shared/errors/signon.js';
import { handle } from './http.js';

export interface AskHandlerDeps {
  loadConfig: () => { vercelEnv: string | undefined; hashSecret: Buffer };
  rateRepo: () => SignerRepo;
  repo: () => CountsRepo;
  now: () => Date;
}

/** POST /api/ask. Same limits as sign, counted in their own bucket so asking never uses up a sign-up. Write endpoints answer 503 outside production. */
export function askHandler(deps: AskHandlerDeps): (req: Request) => Promise<Response> {
  return handle(async (req) => {
    const config = deps.loadConfig();
    if (config.vercelEnv !== 'production') throw new SignonError('unavailable', 'not production');
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      throw new SignonError('bad-request');
    }
    // A malformed body is refused before it uses up the visitor's allowance.
    if (!AskRequestSchema.safeParse(body).success) throw new SignonError('bad-request');
    await checkRateLimit(deps.rateRepo(), hashIp(clientIp(req.headers), config.hashSecret, 'ask'), deps.now());
    await recordAsk(body, deps.repo());
    return new Response(null, { status: 204 });
  });
}

export const askRoute = askHandler({ loadConfig: () => loadBackendConfig(), rateRepo: signerRepo, repo: countsRepo, now: () => new Date() });
