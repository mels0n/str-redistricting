import type { VersionStamp } from '../../shared/config/index.js';
import { DataError } from '../../shared/errors/index.js';
import { NO_BORDER_ONLY_MOVES, type BorderOnlyMoves } from './balance.js';
import type { CountyRef } from './counties.js';
import type { PlanMetrics } from './summary.js';

export interface PlanStats {
  /** The plan's metrics.json fields other than the per-district list. */
  readonly metrics: Record<string, unknown>;
  readonly districts: readonly (PlanMetrics['districts'][number] & { counties: readonly CountyRef[]; landParts?: number })[];
}

/** One plan's published stats: every metrics.json field, with each district carrying the counties it touches. */
export function planStats(
  m: PlanMetrics,
  counties: readonly (readonly CountyRef[])[],
  landParts?: readonly number[],
  borderOnly: BorderOnlyMoves = NO_BORDER_ONLY_MOVES,
): PlanStats {
  const { districts, ...metrics } = m;
  return {
    metrics: { ...metrics, ...borderOnly },
    districts: districts.map((d) => {
      const parts = landParts?.[d.district - 1];
      if (landParts !== undefined && parts === undefined) throw new DataError(`missing land-parts entry for district ${d.district}`);
      return { district: d.district, pop: d.pop, dev: d.dev, devPct: d.devPct, contiguous: d.contiguous, counties: counties[d.district - 1] ?? [], ...(parts === undefined ? {} : { landParts: parts }) };
    }),
  };
}

/** The published stats file. The finished plan is written under `finished` (the generator's own name for it is `official`). */
export function buildStats(finished: PlanStats, beforeBalancing: PlanStats, enactedSource: string, versions: VersionStamp) {
  return { enactedSource, versions, finished, beforeBalancing };
}
