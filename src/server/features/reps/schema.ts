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
/** The file `public/data/reps/coverage.json`; a chamber a state does not have (Nebraska's House) is absent. */
export const CoverageSchema = z.record(z.string().length(2), z.object({ 'state-house': ChamberCoverage.optional(), 'state-senate': ChamberCoverage.optional() }));
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
