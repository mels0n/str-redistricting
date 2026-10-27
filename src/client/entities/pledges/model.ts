import { z } from 'zod';

const OFFICES = ['us-house', 'us-senate', 'state-house', 'state-senate'] as const;
const https = z.string().refine((s) => /^https:\/\/[^\s]+$/.test(s), 'must be an https URL');

/** One public pledge. There is no party field. Mirrors the build's schema (see the parity test). */
export const PledgeSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  role: z.enum(['incumbent', 'candidate']),
  personId: z.string().min(1).nullable(),
  office: z.enum(OFFICES),
  state: z.string().regex(/^[A-Z]{2}$/),
  districtCode: z.string().min(1).nullable(),
  statementUrl: https,
  campaignUrl: https.nullable(),
  pledgedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  cycle: z.number().int().nullable(),
});
export type Pledge = z.infer<typeof PledgeSchema>;

export const PledgesFileSchema = z.strictObject({ pledges: z.array(PledgeSchema) });
export type PledgesFile = z.infer<typeof PledgesFileSchema>;

/** Oldest pledge first, ties by id: the order the page lists them in. */
export function inPledgeOrder(pledges: readonly Pledge[]): Pledge[] {
  return [...pledges].sort((a, b) => (a.pledgedOn < b.pledgedOn ? -1 : a.pledgedOn > b.pledgedOn ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
