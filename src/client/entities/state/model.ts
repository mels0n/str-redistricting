import { z } from 'zod';

export const PlanSummarySchema = z.object({
  population: z.number().int().nonnegative(),
  ideal: z.number().positive(),
  rangePersons: z.number().nonnegative(),
  rangePct: z.number().nonnegative(),
  allContiguous: z.boolean(),
  assignmentSha256: z.string().regex(/^[0-9a-f]{64}$/),
  inputSha256: z.string().regex(/^[0-9a-f]{64}$/),
  angleStepDeg: z.number().positive(),
});

export const StateEntrySchema = z.object({
  abbr: z.string().regex(/^[A-Z]{2}$/),
  name: z.string().min(1),
  seats: z.number().int().positive(),
  hasData: z.boolean(),
  summary: PlanSummarySchema.optional(),
});

export const StateIndexSchema = z.object({ states: z.array(StateEntrySchema).min(1) });

export type PlanSummary = z.infer<typeof PlanSummarySchema>;
export type StateEntry = z.infer<typeof StateEntrySchema>;
export type StateIndex = z.infer<typeof StateIndexSchema>;

/** A state whose map has been generated: it always carries a summary. */
export type GeneratedState = StateEntry & { hasData: true; summary: PlanSummary };

export function isGenerated(s: StateEntry): s is GeneratedState {
  return s.hasData && s.summary !== undefined;
}

export function findState(index: StateIndex, abbr: string): StateEntry | undefined {
  return index.states.find((s) => s.abbr === abbr);
}

/** States sorted by name, as the index lists them. */
export function byName(index: StateIndex): StateEntry[] {
  return [...index.states].sort((a, b) => a.name.localeCompare(b.name, 'en-US'));
}
