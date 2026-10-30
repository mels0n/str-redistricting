import { z } from 'zod';

/** One site verified to show the badge. Mirrors the server's answer from /api/badge-sites. */
export const BadgeSiteSchema = z.strictObject({
  /** The page where the badge was found. */
  url: z.string().refine((s) => /^https?:\/\/[^\s]+$/.test(s), 'must be a web address'),
  host: z.string().min(1),
  title: z.string().nullable(),
  name: z.string().nullable(),
  office: z.string().nullable(),
  /** The representative whose own site this is (badge on its home page), or null. */
  id: z.string().nullable(),
});
export type BadgeSite = z.infer<typeof BadgeSiteSchema>;

export const BadgeSitesSchema = z.strictObject({ sites: z.array(BadgeSiteSchema) });

/** The listed site that belongs to the representative with this id, or undefined. Matching is by id, never by website address. */
export function siteForRep(sites: readonly BadgeSite[], repId: string): BadgeSite | undefined {
  return sites.find((s) => s.id !== null && s.id === repId);
}
