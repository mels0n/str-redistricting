import { badgeRepo, type BadgeRepo } from '../entities/badge-db/index.js';
import { db, signerRepo, type SignerRepo } from '../entities/signon-db/index.js';
import { BADGE_SVG, recordSighting } from '../features/badge/index.js';
import { checkRateLimit, clientIp, hashIp } from '../features/signon/index.js';
import { loadBackendConfig } from '../shared/config/backend.js';

export interface BadgeHandlerDeps {
  loadConfig: () => { vercelEnv: string | undefined; hashSecret: Buffer; siteOrigin: string };
  rateRepo: () => SignerRepo;
  repo: () => BadgeRepo;
  now: () => Date;
}

/**
 * GET /api/badge: the badge image. The image is always sent; noting which site asked for it is best effort and happens only in
 * production. Only the page address from the Referer header is kept (see recordSighting); an address is hashed for the rate limit and
 * never stored. Browsers keep the image for an hour, and shared caches are not asked to, so a page's next visitor reaches us again.
 */
export function badgeHandler(deps: BadgeHandlerDeps): (req: Request) => Promise<Response> {
  return async (req) => {
    try {
      const config = deps.loadConfig();
      if (config.vercelEnv === 'production') {
        const ownHosts = [new URL(config.siteOrigin).hostname, 'localhost'];
        const ipHash = hashIp(clientIp(req.headers), config.hashSecret, 'badge');
        const now = deps.now();
        await recordSighting(req.headers.get('referer'), { repo: deps.repo(), ownHosts, limit: () => checkRateLimit(deps.rateRepo(), ipHash, now), now });
      }
    } catch {
      console.error(JSON.stringify({ code: 'badge-record' }));
    }
    return new Response(BADGE_SVG, { headers: { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=3600' } });
  };
}

export const badgeRoute = badgeHandler({ loadConfig: () => loadBackendConfig(), rateRepo: signerRepo, repo: () => badgeRepo(db()), now: () => new Date() });
