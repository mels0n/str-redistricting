import { countsRepo, type CountsRepo } from '../entities/signon-db/index.js';
import { readCounts } from '../features/counts/index.js';
import { handle } from './http.js';

export interface CountsHandlerDeps {
  repo: () => CountsRepo;
}

/** GET /api/counts[?state=CO]. A read endpoint: it also works on previews. */
export function countsHandler(deps: CountsHandlerDeps): (req: Request) => Promise<Response> {
  return handle(async (req) => {
    const query = Object.fromEntries(new URL(req.url).searchParams);
    const body = await readCounts(query, deps.repo());
    return Response.json(body, { headers: { 'cache-control': 'public, s-maxage=60, stale-while-revalidate=300' } });
  });
}

export const countsRoute = countsHandler({ repo: countsRepo });
