import type { CountyRef } from './counties.js';
import type { PlanMetrics } from './summary.js';

export interface PlanStats {
  /** The plan's metrics.json fields other than the per-district list. */
  readonly metrics: Record<string, unknown>;
  readonly districts: readonly (PlanMetrics['districts'][number] & { counties: readonly CountyRef[] })[];
}

/** One plan's published stats: every metrics.json field, with each district carrying the counties it touches. */
export function planStats(m: PlanMetrics, counties: readonly (readonly CountyRef[])[]): PlanStats {
  const { districts, directionsPerCut, ...rest } = m;
  // The generator's internal name for the per-cut counts is `directionsPerCut`; the published name says what they count.
  const metrics = directionsPerCut === undefined ? rest : { ...rest, candidateLinesPerCut: directionsPerCut };
  return {
    metrics,
    districts: districts.map((d) => ({ district: d.district, pop: d.pop, dev: d.dev, devPct: d.devPct, contiguous: d.contiguous, counties: counties[d.district - 1] ?? [] })),
  };
}

/** The published stats file. The finished plan is written under `finished` (the generator's own name for it is `official`). */
export function buildStats(finished: PlanStats, beforeBalancing: PlanStats, enactedSource: string) {
  return { enactedSource, finished, beforeBalancing };
}
