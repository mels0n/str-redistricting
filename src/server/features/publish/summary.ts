import { z } from 'zod';
import type { StateInfo } from '../../shared/apportionment/index.js';

const District = z.object({
  district: z.number().int().positive(),
  pop: z.number(),
  dev: z.number(),
  devPct: z.number(),
  contiguous: z.boolean(),
});

/** The fields of a plan's metrics.json the published data relies on; any others pass through to stats.json. */
export const PlanMetricsSchema = z.object({
  state: z.string(),
  angleStepDeg: z.number(),
  nodeVersion: z.string(),
  inputSha256: z.string(),
  seats: z.number().int().positive(),
  population: z.number(),
  ideal: z.number(),
  districts: z.array(District),
  rangePersons: z.number(),
  rangePct: z.number(),
  allContiguous: z.boolean(),
  assignmentSha256: z.string(),
}).passthrough();
export type PlanMetrics = z.infer<typeof PlanMetricsSchema>;

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
  /** Date (YYYY-MM-DD) the plan was generated, from its output file. */
  readonly generated: string;
}

export interface IndexEntry {
  readonly abbr: string;
  readonly name: string;
  readonly seats: number;
  readonly hasData: boolean;
  readonly summary?: StateSummary;
}

export function summarize(m: PlanMetrics, generated: string): StateSummary {
  return {
    population: m.population, ideal: m.ideal, rangePersons: m.rangePersons, rangePct: m.rangePct,
    allContiguous: m.allContiguous, assignmentSha256: m.assignmentSha256, inputSha256: m.inputSha256,
    nodeVersion: m.nodeVersion, angleStepDeg: m.angleStepDeg, generated,
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
