import { z } from 'zod';
import type { Office } from '../../shared';

const OFFICES = ['us-house', 'us-senate', 'state-house', 'state-senate'] as const satisfies readonly Office[];
const text = z.string().min(1).nullable();

/** One person who holds a seat. There is deliberately no party field. Mirrors the publisher's schema (see the parity test). */
export const RepSchema = z.object({
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

/** The file `reps/<ST>.json`: every rep of one state, under `<ST>:<office>:<code>` keys. */
export const StateRepsSchema = z.object({
  state: z.string().length(2),
  generatedFrom: z.record(z.string().min(1), z.string().regex(/^[0-9a-f]{64}$/)),
  byKey: z.record(z.string().min(1), z.array(RepSchema).min(1)),
});
export type StateReps = z.infer<typeof StateRepsSchema>;

/** The district code US senators are filed under: a Senate seat is statewide. */
export const STATEWIDE_CODE = 'state';
