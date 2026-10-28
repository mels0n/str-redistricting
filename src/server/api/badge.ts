import { waitUntil } from '@vercel/functions';
import { badgeRepo, type BadgeRepo } from '../entities/badge-db/index.js';
import { db, signerRepo, type SignerRepo } from '../entities/signon-db/index.js';
import { BADGE_SVG, IMMEDIATE_CHECKS_PER_HOUR, recordSighting, verifyNow } from '../features/badge/index.js';
import { checkRateLimit, clientIp, hashIp } from '../features/signon/index.js';
import { loadBackendConfig } from '../shared/config/backend.js';

export interface BadgeHandlerDeps {
  loadConfig: () => { vercelEnv: string | undefined; hashSecret: Buffer; siteOrigin: string };
  rateRepo: () => SignerRepo;
  repo: () => BadgeRepo;
  now: () => Date;
  /** Runs work after the response has gone out (Vercel's `waitUntil`). */
  after: (work: Promise<unknown>) => void;
  /** Replaces the page fetch in tests. */
  fetchPage?: Parameters<typeof verifyNow>[1]['fetchPage'];
}

/**
 * GET /api/badge: the badge image. The image is always sent; noting which site asked for it is best effort and happens only in
 * production. Only the page address from the Referer header is kept (see recordSighting); an address is hashed for the rate limit and
 * never stored. Browsers keep the image for an hour, and shared caches are not asked to, so a page's next visitor reaches us again.
 * A page that is new, or not verified in a day, is checked right after the response, within a site-wide limit per hour.
 */
export function badgeHandler(deps: BadgeHandlerDeps): (req: Request) => Promise<Response> {
  return async (req) => {
    try {
      const config = deps.loadConfig();
      if (config.vercelEnv === 'production') {
        const ownHosts = [new URL(config.siteOrigin).hostname, 'localhost'];
        const ipHash = hashIp(clientIp(req.headers), config.hashSecret, 'badge');
        const now = deps.now();
        const repo = deps.repo();
        const seen = await recordSighting(req.headers.get('referer'), { repo, ownHosts, limit: () => checkRateLimit(deps.rateRepo(), ipHash, now), now });
        if (seen.url !== null && seen.needsCheck) {
          const siteHost = ownHosts[0]!;
          const everyone = hashIp('all', config.hashSecret, 'badge-check');
          deps.after(
            verifyNow(seen.url, {
              repo,
              siteHost,
              now: deps.now,
              ...(deps.fetchPage ? { fetchPage: deps.fetchPage } : {}),
              allow: () => checkRateLimit(deps.rateRepo(), everyone, deps.now(), IMMEDIATE_CHECKS_PER_HOUR).then(() => true, () => false),
            }).catch(() => undefined),
          );
        }
      }
    } catch {
      console.error(JSON.stringify({ code: 'badge-record' }));
    }
    return new Response(BADGE_SVG, { headers: { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=3600' } });
  };
}

export const badgeRoute = badgeHandler({ loadConfig: () => loadBackendConfig(), rateRepo: signerRepo, repo: () => badgeRepo(db()), now: () => new Date(), after: (work) => waitUntil(work) });
