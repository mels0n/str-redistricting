import { readFileSync } from 'node:fs';
import { z } from 'zod';

const OFFICES = ['us-house', 'us-senate', 'state-house', 'state-senate'] as const;
const https = z.string().refine((s) => /^https:\/\/[^\s]+$/.test(s), 'must be an https URL');

/** One public pledge. There is deliberately no party field: the object is strict, so one cannot slip in. */
export const PledgeSchema = z
  .strictObject({
    id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'must be kebab-case'),
    name: z.string().min(1),
    role: z.enum(['incumbent', 'candidate']),
    /** The matching rep's id (bioguide ID or Open States person id); required for an incumbent. */
    personId: z.string().min(1).nullable(),
    office: z.enum(OFFICES),
    state: z.string().regex(/^[A-Z]{2}$/),
    /** Null only for the U.S. Senate, whose seats are statewide. */
    districtCode: z.string().min(1).nullable(),
    statementUrl: https,
    campaignUrl: https.nullable(),
    pledgedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), 'must be a real date'),
    cycle: z.number().int().nullable(),
  })
  .superRefine((p, ctx) => {
    if (p.role === 'incumbent' && p.personId === null) ctx.addIssue({ code: 'custom', path: ['personId'], message: 'an incumbent needs a personId' });
    if ((p.districtCode === null) !== (p.office === 'us-senate')) ctx.addIssue({ code: 'custom', path: ['districtCode'], message: 'districtCode is null for the U.S. Senate and set for every other office' });
  });
export type Pledge = z.infer<typeof PledgeSchema>;

/** The file `config/pledges.json`, published as `data/pledges.json`. */
export const PledgesFileSchema = z.strictObject({ pledges: z.array(PledgeSchema) }).superRefine((f, ctx) => {
  const seen = new Set<string>();
  f.pledges.forEach((p, i) => {
    if (seen.has(p.id)) ctx.addIssue({ code: 'custom', path: ['pledges', i, 'id'], message: `duplicate id ${p.id}` });
    seen.add(p.id);
  });
});
export type PledgesFile = z.infer<typeof PledgesFileSchema>;

/** Reads and validates a pledges file; an unreadable or invalid file throws, which fails the build. */
export function readPledgesFile(path: string): PledgesFile {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Error(`${path}: not readable JSON`);
  }
  const parsed = PledgesFileSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`${path}: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  return parsed.data;
}
