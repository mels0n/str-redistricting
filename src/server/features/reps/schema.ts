import { z } from 'zod';

export const OFFICES = ['us-house', 'us-senate', 'state-house', 'state-senate'] as const;
export type Office = (typeof OFFICES)[number];

const text = z.string().min(1).nullable();

/** One person who holds a seat. There is deliberately no party field anywhere in this data. */
export const RepSchema = z.object({
  /** The bioguide ID for Congress, the Open States `ocd-person/...` ID for state legislators. */
  id: z.string().min(1),
  name: z.string().min(1),
  office: z.enum(OFFICES),
  districtCode: text,
  contactUrl: text,
  email: text,
  phone: text,
  address: text,
  website: text,
  social: z.object({ x: z.string().min(1), bluesky: z.string().min(1), facebook: z.string().min(1), instagram: z.string().min(1) }).partial(),
});
export type Rep = z.infer<typeof RepSchema>;

/** The file `public/data/reps/<ST>.json`: every rep of one state, under `<ST>:<office>:<code>` keys. */
export const StateRepsSchema = z.object({
  state: z.string().length(2),
  /** Source file name to the sha256 it was published from. */
  generatedFrom: z.record(z.string().min(1), z.string().regex(/^[0-9a-f]{64}$/)),
  byKey: z.record(z.string().min(1), z.array(RepSchema).min(1)),
});
export type StateReps = z.infer<typeof StateRepsSchema>;

const ChamberCoverage = z.object({ matched: z.number().int().nonnegative(), unmatched: z.array(z.string()) });
/**
 * The file `public/data/reps/coverage.json`; a chamber a state does not have (Nebraska's House) is absent. `us-house`
 * is present only for a state with a House seat that has no member, and lists those seats (`FL-20`).
 */
export const CoverageSchema = z.record(
  z.string().length(2),
  z.object({ 'us-house': z.object({ vacant: z.array(z.string().regex(/^[A-Z]{2}-\d{2}$/)) }).optional(), 'state-house': ChamberCoverage.optional(), 'state-senate': ChamberCoverage.optional() }),
);
export type Coverage = z.infer<typeof CoverageSchema>;

/** The district code a senator is filed under (`CO:us-senate:state`): a Senate seat is statewide. The senator's own `districtCode` stays null. */
export const STATEWIDE_CODE = 'state';

/** `CO:state-house:012`. */
export function districtKey(state: string, office: Office, code: string): string {
  return `${state}:${office}:${code}`;
}

/** A rep together with the state it sits in, as the parsers return it. */
export type StatedRep = Rep & { state: string };

/** Hosts that name a party or a party caucus; a website there would reveal party, so it is never published. */
const PARTY_HOST = /republican|democrat|gop|dems|caucus/i;

/** The address if it is usable and its host does not name a party, else null. */
export function publishableWebsite(url: string | null | undefined): string | null {
  const v = url?.trim();
  if (v === undefined || v === '') return null;
  try {
    return PARTY_HOST.test(new URL(v).hostname) ? null : v;
  } catch {
    return null;
  }
}

/**
 * The file `public/data/reps/websites.json`: who the website on each host belongs to (host lower-case, "www." removed), so a site that
 * shows the badge can be shown with its owner's name and seat. A host that more than one person uses is left out. No party, no contact details.
 */
export const WebsitesSchema = z.record(z.string().min(1), z.object({ name: z.string().min(1), office: z.enum(OFFICES), state: z.string().regex(/^[A-Z]{2}$/), id: z.string().min(1) }));
export type Websites = z.infer<typeof WebsitesSchema>;

/** The lower-case host of a website address with a leading "www." removed, or null when it is not a usable address. */
export function websiteHost(url: string | null | undefined): string | null {
  try {
    return url ? new URL(url.trim()).hostname.toLowerCase().replace(/^www\./, '') || null : null;
  } catch {
    return null;
  }
}

/** The host to person map for the badge page: every rep with a website, minus hosts that two or more people share. */
export function buildWebsites(files: readonly StateReps[]): Websites {
  const byHost = new Map<string, Websites[string] | null>();
  for (const file of files) {
    for (const reps of Object.values(file.byKey)) {
      for (const rep of reps) {
        const host = websiteHost(rep.website);
        if (host === null) continue;
        byHost.set(host, byHost.has(host) ? null : { name: rep.name, office: rep.office, state: file.state, id: rep.id });
      }
    }
  }
  const out: Websites = {};
  for (const host of [...byHost.keys()].sort()) {
    const who = byHost.get(host);
    if (who) out[host] = who;
  }
  return out;
}
