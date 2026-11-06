import { z } from 'zod';
import type { BadgeRepo } from '../../entities/badge-db/index.js';
import { bareHost } from './referrer.js';

export const MAX_LISTED = 200;

const OFFICE_LABEL = { 'us-house': 'U.S. House', 'us-senate': 'U.S. Senate', 'state-house': 'State House', 'state-senate': 'State Senate' } as const;

/** `public/data/reps/websites.json`: the representative whose website is on each host (www removed). A host two people share is left out. */
export const WebsitesFileSchema = z.record(
  z.string().min(1),
  z.object({ name: z.string().min(1), office: z.enum(['us-house', 'us-senate', 'state-house', 'state-senate']), state: z.string().regex(/^[A-Z]{2}$/), id: z.string().min(1) }),
);
export type WebsitesFile = z.infer<typeof WebsitesFileSchema>;

export interface BadgeSite {
  /** The page where the badge was found: the exact page to link to. */
  url: string;
  host: string;
  title: string | null;
  name: string | null;
  office: string | null;
  /** The representative's id, so the Take action page can mark the right person; set together with name and office. */
  id: string | null;
}

/**
 * The sites to list: verified and not failing, newest first, one per host, at most 200. The row shown for a host is the one whose badge
 * was found on its home page when there is one, else its newest page, so a newer inner page never hides the home page. A site whose
 * host is the website of a representative also carries that person's name, seat and id, but only when the badge was found on the
 * site's home page: a badge on some inner page (a supporter's page, a post) says nothing about the site's owner. No other fact about
 * anyone is added.
 */
export async function readBadgeSites(repo: BadgeRepo, websites: WebsitesFile): Promise<{ sites: BadgeSite[] }> {
  const rows = await repo.listed(MAX_LISTED * 5);
  const isHome = (r: (typeof rows)[number]): boolean => r.foundUrl !== null && new URL(r.foundUrl).pathname === '/';
  // Map keeps the order hosts were first met in, which is newest first.
  const byHost = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    const key = bareHost(r.host);
    const kept = byHost.get(key);
    if (kept === undefined || (!isHome(kept) && isHome(r))) byHost.set(key, r);
  }
  const sites: BadgeSite[] = [];
  for (const [key, r] of byHost) {
    const rep = isHome(r) && Object.hasOwn(websites, key) ? websites[key] : undefined;
    sites.push({ url: r.foundUrl ?? r.url, host: r.host, title: r.title, name: rep?.name ?? null, office: rep ? `${OFFICE_LABEL[rep.office]}, ${rep.state}` : null, id: rep?.id ?? null });
    if (sites.length === MAX_LISTED) break;
  }
  return { sites };
}
