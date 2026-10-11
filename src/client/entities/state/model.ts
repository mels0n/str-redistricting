import { z } from 'zod';
import { VersionStampSchema, type Chamber } from '../../shared';

export const PlanSummarySchema = z.object({
  population: z.number().int().nonnegative(),
  ideal: z.number().positive(),
  rangePersons: z.number().nonnegative(),
  rangePct: z.number().nonnegative(),
  allContiguous: z.boolean(),
  assignmentSha256: z.string().regex(/^[0-9a-f]{64}$/),
  inputSha256: z.string().regex(/^[0-9a-f]{64}$/),
  lineSearch: z.string(),
  versions: VersionStampSchema.optional(),
});

export const ChamberEntrySchema = z.object({
  seats: z.number().int().nonnegative(),
  hasData: z.boolean(),
  summary: PlanSummarySchema.optional(),
});

export const StateEntrySchema = z.object({
  abbr: z.string().regex(/^[A-Z]{2}$/),
  name: z.string().min(1),
  seats: z.number().int().positive(),
  hasData: z.boolean(),
  summary: PlanSummarySchema.optional(),
  /** The state chambers, when the index has them; an older index has none. */
  chambers: z
    .object({ 'state-house': ChamberEntrySchema.optional(), 'state-senate': ChamberEntrySchema.optional() })
    .optional(),
});

export const StateIndexSchema = z.object({ states: z.array(StateEntrySchema).min(1) });

export type PlanSummary = z.infer<typeof PlanSummarySchema>;
export type ChamberEntry = z.infer<typeof ChamberEntrySchema>;
export type StateEntry = z.infer<typeof StateEntrySchema>;
export type StateIndex = z.infer<typeof StateIndexSchema>;

/** A state whose map has been generated: it always carries a summary. */
export type GeneratedState = StateEntry & { hasData: true; summary: PlanSummary };

export function isGenerated(s: StateEntry): s is GeneratedState {
  return s.hasData && s.summary !== undefined;
}

/** What one chamber of a state has in the index; the federal House is the entry itself. */
export interface ChamberView {
  seats: number;
  hasData: boolean;
  summary: PlanSummary | undefined;
}

export function chamberView(s: StateEntry, chamber: Chamber): ChamberView {
  if (chamber === 'federal-house') return { seats: s.seats, hasData: s.hasData, summary: s.summary };
  const c = s.chambers?.[chamber];
  return { seats: c?.seats ?? 0, hasData: c?.hasData ?? false, summary: c?.summary };
}

/** Districts the state has in a chamber (0: it has no such chamber). */
export function seatsIn(s: StateEntry, chamber: Chamber): number {
  return chamberView(s, chamber).seats;
}

/** Whether the chamber's map is drawn and published, with its summary. */
export function isGeneratedIn(s: StateEntry, chamber: Chamber): boolean {
  const v = chamberView(s, chamber);
  return v.hasData && v.summary !== undefined;
}

/** The chambers that have maps for at least one state. The federal House always counts. */
export function liveChambers(index: StateIndex): Set<Chamber> {
  const live = new Set<Chamber>(['federal-house']);
  for (const s of index.states) {
    for (const c of ['state-house', 'state-senate'] as const) if (s.chambers?.[c]?.hasData) live.add(c);
  }
  return live;
}

export function findState(index: StateIndex, abbr: string): StateEntry | undefined {
  return index.states.find((s) => s.abbr === abbr);
}

/** States sorted by name, as the index lists them. */
export function byName(index: StateIndex): StateEntry[] {
  return [...index.states].sort((a, b) => a.name.localeCompare(b.name, 'en-US'));
}
