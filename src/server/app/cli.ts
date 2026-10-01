import { join } from 'node:path';
import { buildTopology } from '../entities/census-block/index.js';
import { balance } from '../features/balance/index.js';
import { loadStateBlocks } from '../features/census/index.js';
import { bordersGeoJson, cutsGeoJson, districtsGeoJson, writePlan } from '../features/export/index.js';
import { assignmentCsv, computeMetrics } from '../features/metrics/index.js';
import { createContext, splitState } from '../features/splitline/index.js';
import { parseConfig } from '../shared/config/index.js';
import { exitCodeFor } from '../shared/errors/index.js';

async function main(): Promise<void> {
  const config = parseConfig(process.argv.slice(2));
  const summary: Record<string, unknown>[] = [];
  for (const state of config.states) {
    const t0 = performance.now();
    const blocks = await loadStateBlocks(state, config.cacheDir);
    const topo = buildTopology(blocks);
    const ctx = createContext(blocks, config.angleStepDeg, topo);
    const split = splitState(ctx, state.seats);
    const tSplit = performance.now();
    const balanced = balance(blocks, topo, split.assignment, state.seats);
    const tBal = performance.now();
    const variants = [
      { name: 'per-cut', assignment: split.assignment, moves: 0, ms: tSplit - t0 },
      { name: 'balanced', assignment: balanced.assignment, moves: balanced.moves, ms: tBal - t0 },
    ];
    for (const v of variants) {
      const metrics = computeMetrics(blocks, topo, v.assignment, state.seats);
      const extra = {
        state: state.abbr, variant: v.name, angleStepDeg: config.angleStepDeg, bridges: topo.bridges.length,
        cutsSkipped: split.cuts.reduce((s, c) => s + c.skipped, 0), balanceMoves: v.moves, runtimeMs: Math.round(v.ms),
      };
      await writePlan(join(config.outDir, state.abbr, v.name), {
        'assignment.csv': assignmentCsv(blocks, v.assignment),
        'metrics.json': JSON.stringify({ ...extra, ...metrics }, null, 2),
        'borders.geojson': JSON.stringify(bordersGeoJson(topo, v.assignment, state.seats)),
        'districts.geojson': JSON.stringify(districtsGeoJson(topo, v.assignment, state.seats)),
        'cuts.geojson': JSON.stringify(cutsGeoJson(split.cuts)),
      });
      summary.push({
        ...extra, blocks: blocks.length, rangePersons: metrics.rangePersons, rangePct: Number(metrics.rangePct.toFixed(4)),
        contiguous: metrics.allContiguous, countiesSplit: `${metrics.countiesSplit}/${metrics.countiesTotal}`,
        sha256: metrics.assignmentSha256.slice(0, 12),
      });
    }
  }
  console.table(summary);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(exitCodeFor(err));
});
