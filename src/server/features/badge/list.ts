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
  url: string;
  host: string;
  title: string | null;
  name: string | null;
  office: string | null;
}

/**
 * The sites to list: verified and not failing, newest first, one per host (the newest page), at most 200. A site whose host is the
 * website of a representative also carries that person's name and seat; no other fact about anyone is added.
 */
export async function readBadgeSites(repo: BadgeRepo, websites: WebsitesFile): Promise<{ sites: BadgeSite[] }> {
  const rows = await repo.listed(MAX_LISTED * 5);
  const seen = new Set<string>();
  const sites: BadgeSite[] = [];
  for (const r of rows) {
    const key = bareHost(r.host);
    if (seen.has(key)) continue;
    seen.add(key);
    const rep = Object.hasOwn(websites, key) ? websites[key] : undefined;
    sites.push({ url: r.url, host: r.host, title: r.title, name: rep?.name ?? null, office: rep ? `${OFFICE_LABEL[rep.office]}, ${rep.state}` : null });
    if (sites.length === MAX_LISTED) break;
  }
  return { sites };
}
