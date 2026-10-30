import { badgeRepo, type BadgeRepo } from '../entities/badge-db/index.js';
import { db } from '../entities/signon-db/index.js';
import { loadWebsites, readBadgeSites, type WebsitesFile } from '../features/badge/index.js';
import { loadSiteOrigin } from '../shared/config/backend.js';
import { handle } from './http.js';

export interface BadgeSitesHandlerDeps {
  repo: () => BadgeRepo;
  websites: () => Promise<WebsitesFile>;
}

/** GET /api/badge-sites: the sites verified to show the badge, newest first. A read endpoint: it also works on previews. */
export function badgeSitesHandler(deps: BadgeSitesHandlerDeps): (req: Request) => Promise<Response> {
  return handle(async () => {
    const body = await readBadgeSites(deps.repo(), await deps.websites());
    return Response.json(body, { headers: { 'cache-control': 'public, s-maxage=300, stale-while-revalidate=600' } });
  });
}

export const badgeSitesRoute = badgeSitesHandler({ repo: () => badgeRepo(db()), websites: () => loadWebsites(loadSiteOrigin()) });
