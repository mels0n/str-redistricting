import { z } from 'zod';

/** One site verified to show the badge. Mirrors the server's answer from /api/badge-sites. */
export const BadgeSiteSchema = z.strictObject({
  /** The page where the badge was found. */
  url: z.string().refine((s) => /^https?:\/\/[^\s]+$/.test(s), 'must be a web address'),
  host: z.string().min(1),
  title: z.string().nullable(),
  name: z.string().nullable(),
  office: z.string().nullable(),
});
export type BadgeSite = z.infer<typeof BadgeSiteSchema>;

export const BadgeSitesSchema = z.strictObject({ sites: z.array(BadgeSiteSchema) });

/** A host without a leading "www.", lower-case. */
export function bareHost(host: string): string {
  return host.toLowerCase().replace(/^www\./, '');
}

/** The listed site that is on the same host as a website address (www ignored), or undefined. */
export function siteForWebsite(sites: readonly BadgeSite[], website: string | null | undefined): BadgeSite | undefined {
  if (!website) return undefined;
  let host: string;
  try {
    host = bareHost(new URL(website.trim()).hostname);
  } catch {
    return undefined;
  }
  return sites.find((s) => bareHost(s.host) === host);
}
