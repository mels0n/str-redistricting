import { z } from 'zod';
import { PlanMetricsSchema, type PlanMetrics } from '../../entities/plan-output/index.js';
import type { VersionStamp } from '../../shared/config/index.js';
import type { StateInfo } from '../../shared/apportionment/index.js';

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
  readonly inputSha256: string;
  readonly nodeVersion: string;
  readonly angleStepDeg: number;
  readonly versions?: VersionStamp;
}

export interface IndexEntry {
  readonly abbr: string;
  readonly name: string;
  readonly seats: number;
  readonly hasData: boolean;
  readonly summary?: StateSummary;
}

export function summarize(m: PublishedMetrics, versions?: VersionStamp): StateSummary {
  return {
    population: m.population, ideal: m.ideal, rangePersons: m.rangePersons, rangePct: m.rangePct,
    allContiguous: m.allContiguous, assignmentSha256: m.assignmentSha256, inputSha256: m.inputSha256,
    nodeVersion: m.nodeVersion, angleStepDeg: m.angleStepDeg,
    ...(versions ? { versions } : {}),
  };
}

/** index.json: every state in the apportionment table, with a summary where a plan was generated. */
export function buildIndex(states: readonly StateInfo[], summaries: ReadonlyMap<string, StateSummary>): { states: IndexEntry[] } {
  return {
    states: states.map((s) => {
      const summary = summaries.get(s.abbr);
      return { abbr: s.abbr, name: s.name, seats: s.seats, hasData: summary !== undefined, ...(summary ? { summary } : {}) };
    }),
  };
}
