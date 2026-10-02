import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildTopology } from '../entities/census-block/index.js';
import { balance } from '../features/balance/index.js';
import { ensureZip, loadStateBlocks } from '../features/census/index.js';
import { bordersGeoJson, cutsGeoJson, districtsGeoJson, writePlan } from '../features/export/index.js';
import { assignmentCsv, computeMetrics } from '../features/metrics/index.js';
import { createContext, splitState } from '../features/splitline/index.js';
import { parseConfig } from '../shared/config/index.js';
import { exitCodeFor } from '../shared/errors/index.js';

async function main(): Promise<void> {
  const config = parseConfig(process.argv.slice(2));
  const summary: Record<string, unknown>[] = [];
  let firstError: unknown;
  for (const state of config.states) {
    try {
      const t0 = performance.now();
      const inputSha256 = createHash('sha256').update(await readFile(await ensureZip(state, config.cacheDir))).digest('hex');
      const blocks = await loadStateBlocks(state, config.cacheDir);
      const topo = buildTopology(blocks);
      const ctx = createContext(blocks, config.angleStepDeg, topo);
      const split = splitState(ctx, state.seats);
      const balanced = balance(blocks, topo, split.assignment, state.seats);
      const runtimeMs = Math.round(performance.now() - t0);
      const sum = (f: (c: (typeof split.cuts)[number]) => number): number => split.cuts.reduce((s, c) => s + f(c), 0);
      // Stray counts are net per block, both directions summed over all cuts.
      const common = {
        state: state.abbr, angleStepDeg: config.angleStepDeg, bridges: topo.bridges.length, nodeVersion: process.version, inputSha256,
        cutsSkipped: sum((c) => c.skipped), strayCapRejected: sum((c) => c.strayCapRejected),
        strayBlocksMoved: sum((c) => c.strayBlocksMoved), strayPopMoved: sum((c) => c.strayPopMoved),
      };
      const before = computeMetrics(blocks, topo, split.assignment, state.seats);
      const official = computeMetrics(blocks, topo, balanced.assignment, state.seats);
      const plans = [
        { dir: join(config.outDir, state.abbr, 'before-balancing'), assignment: split.assignment, metrics: before, moves: 0 },
        { dir: join(config.outDir, state.abbr), assignment: balanced.assignment, metrics: official, moves: balanced.moves },
      ];
      for (const p of plans) {
        await writePlan(p.dir, {
          'assignment.csv': assignmentCsv(blocks, p.assignment),
          'metrics.json': JSON.stringify({ ...common, balanceMoves: p.moves, runtimeMs, ...p.metrics }, null, 2),
          'borders.geojson': JSON.stringify(bordersGeoJson(topo, p.assignment, state.seats)),
          'districts.geojson': JSON.stringify(districtsGeoJson(topo, p.assignment, state.seats)),
          'cuts.geojson': JSON.stringify(cutsGeoJson(split.cuts)),
        });
      }
      summary.push({
        state: state.abbr, status: 'ok', seats: state.seats, blocks: blocks.length,
        rangePersons: official.rangePersons, rangePct: Number(official.rangePct.toFixed(4)),
        beforeBalancingRange: before.rangePersons, contiguous: official.allContiguous,
        cutsSkipped: common.cutsSkipped, strayCapRejected: common.strayCapRejected, strayPop: common.strayPopMoved, balanceMoves: balanced.moves,
        countiesSplit: `${official.countiesSplit}/${official.countiesTotal}`, runtimeMs,
        sha256: official.assignmentSha256.slice(0, 12),
      });
    } catch (err) {
      firstError ??= err;
      summary.push({ state: state.abbr, status: err instanceof Error ? err.message : String(err), seats: state.seats });
    }
  }
  console.table(summary);
  if (firstError !== undefined) throw firstError;
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(exitCodeFor(err));
});
