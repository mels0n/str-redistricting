export interface MetricsJsonInput {
  /** The run-wide numbers shared by both plans of a state (state, versions, hashes, process counts). */
  readonly common: Readonly<Record<string, unknown>>;
  /** Range of the population gap before and after balancing. */
  readonly range: { readonly rangeBeforeBalancing: number; readonly rangeAfterBalancing: number };
  readonly plan: { readonly moves: number; readonly moved: number };
  readonly runtimeMs: number;
  /** The plan's computed metrics (the metrics feature's PlanMetrics); spread into the file as is. */
  readonly metrics: object;
}

/** The object serialized as a plan's metrics.json. Field order is part of the file's bytes. */
export function buildMetricsJson(input: MetricsJsonInput): Record<string, unknown> {
  const { common, range, plan, runtimeMs, metrics } = input;
  return { ...common, balanceMoves: plan.moves, peopleMovedByBalancing: plan.moved, ...range, runtimeMs, ...metrics };
}
