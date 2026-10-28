import { z } from 'zod';
import { STATES } from '../../shared/apportionment/index.js';
import { publishableWebsite, RepSchema, type StatedRep } from './schema.js';

const Term = z.object({
  type: z.enum(['rep', 'sen']),
  state: z.string(),
  district: z.number().int().optional(),
  url: z.string().optional(),
  contact_form: z.string().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
}).passthrough();

const Legislator = z.object({
  id: z.object({ bioguide: z.string().min(1) }).passthrough(),
  name: z.object({ first: z.string(), last: z.string(), official_full: z.string().optional() }).passthrough(),
  terms: z.array(Term).min(1),
}).passthrough();

const SocialEntry = z.object({
  id: z.object({ bioguide: z.string().min(1) }).passthrough(),
  social: z.record(z.string(), z.unknown()),
}).passthrough();

const STATE_ABBRS: ReadonlySet<string> = new Set(STATES.map((s) => s.abbr));
const orNull = (v: string | undefined): string | null => (v !== undefined && v.trim() !== '' ? v.trim() : null);

/** The social accounts the site links to; the file spells the X account `twitter`. */
function socialOf(entry: z.infer<typeof SocialEntry> | undefined): StatedRep['social'] {
  const out: StatedRep['social'] = {};
  if (entry === undefined) return out;
  const pick = (key: string): string | undefined => {
    const v = entry.social[key];
    return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
  };
  const x = pick('twitter');
  const facebook = pick('facebook');
  const instagram = pick('instagram');
  if (x !== undefined) out.x = x;
  if (facebook !== undefined) out.facebook = facebook;
  if (instagram !== undefined) out.instagram = instagram;
  return out;
}

/**
 * Current members of Congress from legislators-current.json and legislators-social-media.json, for the 50 states
 * (delegates and territories are left out). Contact details come from each member's last term. A House seat's
 * `districtCode` is two digits (`00` for an at-large state); a senator has none. No party is read or kept.
 */
export function parseCongress(legislators: unknown, social: unknown): StatedRep[] {
  const members = z.array(Legislator).parse(legislators);
  const socialById = new Map(z.array(SocialEntry).parse(social).map((e) => [e.id.bioguide, e]));
  const out: StatedRep[] = [];
  for (const m of members) {
    const term = m.terms[m.terms.length - 1]!;
    if (!STATE_ABBRS.has(term.state)) continue;
    const house = term.type === 'rep';
    out.push({
      ...RepSchema.parse({
        id: m.id.bioguide,
        name: orNull(m.name.official_full) ?? `${m.name.first} ${m.name.last}`,
        office: house ? 'us-house' : 'us-senate',
        districtCode: house ? String(term.district ?? 0).padStart(2, '0') : null,
        contactUrl: orNull(term.contact_form),
        email: null,
        phone: orNull(term.phone),
        address: orNull(term.address),
        website: publishableWebsite(term.url),
        social: socialOf(socialById.get(m.id.bioguide)),
      }),
      state: term.state,
    });
  }
  return out;
}
