import { z } from 'zod';
import { PlanMetricsSchema, type PlanMetrics } from '../../entities/plan-output/index.js';
import type { VersionStamp } from '../../shared/config/index.js';
import type { StateInfo } from '../../shared/apportionment/index.js';
import { seatsFor } from '../../shared/chamber/index.js';

export { PlanMetricsSchema };
export type { PlanMetrics };

/** The same fields without the per-district list: what a published stats.json keeps under `metrics`. */
export const PublishedMetricsSchema = PlanMetricsSchema.omit({ districts: true });
export type PublishedMetrics = z.infer<typeof PublishedMetricsSchema>;

/** The stamp as read back from a published stats.json; absent in data published before versioning. */
export const PublishedStampSchema = z.strictObject({
  engine: z.string(),
  input: z.strictObject({ vintage: z.string(), revision: z.number().int(), sha256: z.string() }),
  maps: z.number().int(),
  schema: z.string(),
});

export interface StateSummary {
  readonly population: number;
  readonly ideal: number;
  readonly rangePersons: number;
  readonly rangePct: number;
  readonly allContiguous: boolean;
  readonly assignmentSha256: string;
  /** Fingerprint of the before-balancing plan; absent from indexes built before it was recorded. */
  readonly beforeAssignmentSha256?: string;
  readonly inputSha256: string;
  readonly nodeVersion: string;
  readonly lineSearch: string;
  readonly versions?: VersionStamp;
}

/** The two state chambers an index entry describes. */
export const STATE_CHAMBERS = ['state-house', 'state-senate'] as const;
export type StateChamber = (typeof STATE_CHAMBERS)[number];

/** One state chamber in the index: its district count (0 when the state has no such chamber) and, once drawn, its summary. */
export interface ChamberEntry {
  readonly seats: number;
  readonly hasData: boolean;
  readonly summary?: StateSummary;
}

export interface IndexEntry {
  readonly abbr: string;
  readonly name: string;
  readonly seats: number;
  readonly hasData: boolean;
  readonly summary?: StateSummary;
  /** Both state chambers, when the index was built with them; the federal fields above are the same either way. */
  readonly chambers?: Record<StateChamber, ChamberEntry>;
}

export function summarize(m: PublishedMetrics, versions?: VersionStamp, beforeAssignmentSha256?: string): StateSummary {
  return {
    population: m.population, ideal: m.ideal, rangePersons: m.rangePersons, rangePct: m.rangePct,
    allContiguous: m.allContiguous, assignmentSha256: m.assignmentSha256, inputSha256: m.inputSha256,
    nodeVersion: m.nodeVersion, lineSearch: m.lineSearch,
    ...(beforeAssignmentSha256 ? { beforeAssignmentSha256 } : {}),
    ...(versions ? { versions } : {}),
  };
}

/**
 * index.json: every state in the apportionment table, with a summary where a plan was generated. With `chambers` (each
 * chamber's summaries by state), every state also lists both state chambers, so a viewer can tell "not drawn yet" from "none".
 */
export function buildIndex(
  states: readonly StateInfo[],
  summaries: ReadonlyMap<string, StateSummary>,
  chambers?: Readonly<Record<StateChamber, ReadonlyMap<string, StateSummary>>>,
): { states: IndexEntry[] } {
  return {
    states: states.map((s) => {
      const summary = summaries.get(s.abbr);
      const entry = (chamber: StateChamber): ChamberEntry => {
        const own = chambers![chamber].get(s.abbr);
        return { seats: seatsFor(s, chamber), hasData: own !== undefined, ...(own ? { summary: own } : {}) };
      };
      return {
        abbr: s.abbr, name: s.name, seats: s.seats, hasData: summary !== undefined, ...(summary ? { summary } : {}),
        ...(chambers ? { chambers: { 'state-house': entry('state-house'), 'state-senate': entry('state-senate') } } : {}),
      };
    }),
  };
}
