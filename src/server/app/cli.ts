import { join } from 'node:path';
import { blocksFileName, buildTopology, loadStateBlocks } from '../entities/census-block/index.js';
import { balance, balanceLog, peopleMoved } from '../features/balance/index.js';
import { bordersGeoJson, bridgesJson, cutsGeoJson, districtsGeoJson, writePlan } from '../features/export/index.js';
import { assignmentCsv, computeMetrics } from '../features/metrics/index.js';
import { drawOrSkip, type WriteFiles } from '../features/run-stamp/index.js';
import { createContext, PoolSlot, splitState, type SplitResult } from '../features/splitline/index.js';
import { LINE_SEARCH, parseConfig, pinnedSha256, VERSIONS, type Config } from '../shared/config/index.js';
import type { StateInfo } from '../shared/apportionment/index.js';
import { exitCodeFor } from '../shared/errors/index.js';
import { exploreCodeSha256, runKeyFor } from './run-key.js';

type Cut = SplitResult['cuts'][number];

/** Per-cut summary of the search. */
function cutStats(c: Cut, i: number) {
  return {
    order: i + 1, depth: c.depth, seats: c.seats, firstDistrict: c.firstDistrict, angleDeg: c.angleDeg, fromDeg: c.fromDeg, toDeg: c.toDeg,
    lengthM: Math.round(c.lengthM), skipped: c.skipped, strayBlocksMoved: c.strayBlocksMoved, strayPopMoved: c.strayPopMoved,
    iterations: c.iterations, offsetShiftM: Math.round(c.offsetShiftM), candidateRanges: c.candidateRanges, reversedRanges: c.reversedRanges, tieSpans: c.tieSpans, reversed: c.reversed, tiedRanges: c.tiedRanges, tiedCuts: c.tiedCuts, splitChanges: c.splitChanges,
  };
}

/** The leading candidates of every cut, in the generator's order, as compact rows. */
function candidateRows(cuts: readonly Cut[]) {
  return {
    fields: ['lowSeats', 'fromDeg', 'toDeg', 'lengthM', 'lowPop', 'reversed'],
    cuts: cuts.map((c) => c.candidates.map((r) => [r.lowSeats, r.fromDeg, r.toDeg, r.lengthM, r.lowPop, r.reversed ? 1 : 0])),
  };
}

/** Draws one state, writing every output through `write`; returns its row for the summary table. */
async function drawState(state: StateInfo, config: Config, slot: PoolSlot, write: WriteFiles): Promise<Record<string, unknown>> {
  const t0 = performance.now();
  // The pinned hash, not a fresh one: loading the blocks refuses a file that does not match it.
  const inputSha256 = pinnedSha256(blocksFileName(state));
  const blocks = await loadStateBlocks(state, config.cacheDir);
  const topo = buildTopology(blocks);
  const ctx = createContext(blocks, topo);
  const split = splitState(ctx, state.seats, { pool: slot.pool });
  const balanced = balance(blocks, topo, split.assignment, state.seats);
  const runtimeMs = Math.round(performance.now() - t0);
  const sum = (f: (c: (typeof split.cuts)[number]) => number): number => split.cuts.reduce((s, c) => s + f(c), 0);
  // Stray counts are net per block, both directions summed over all cuts.
  const common = {
    state: state.abbr, lineSearch: LINE_SEARCH, bridges: topo.bridges.length, nodeVersion: process.version, inputSha256, engine: VERSIONS.engine,
    cutsSkipped: sum((c) => c.skipped),
    strayBlocksMoved: sum((c) => c.strayBlocksMoved), strayPopMoved: sum((c) => c.strayPopMoved),
    // Re-counts: how many times a chosen line was slid again after strays moved, in total and at most for one cut.
    recounts: sum((c) => c.iterations - 1), recountsMaxPerCut: Math.max(0, ...split.cuts.map((c) => c.iterations - 1)),
    // Work done: the candidates each cut considered (ranges of directions with a distinct result), then their total.
    cuts: split.cuts.length, candidateRangesPerCut: split.cuts.map((c) => c.candidateRanges), candidateRangesEvaluated: sum((c) => c.candidateRanges),
  };
  const before = computeMetrics(blocks, topo, split.assignment, state.seats);
  const official = computeMetrics(blocks, topo, balanced.assignment, state.seats);
  const range = { rangeBeforeBalancing: before.rangePersons, rangeAfterBalancing: official.rangePersons };
  const moved = peopleMoved(balanced.moves);
  const plans = [
    { sub: 'before-balancing', assignment: split.assignment, metrics: before, moves: 0, moved: 0 },
    { sub: '', assignment: balanced.assignment, metrics: official, moves: balanced.moves.length, moved },
  ];
  for (const p of plans) {
    await write(p.sub, {
      'assignment.csv': assignmentCsv(blocks, p.assignment),
      'metrics.json': JSON.stringify({ ...common, balanceMoves: p.moves, peopleMovedByBalancing: p.moved, ...range, runtimeMs, ...p.metrics }, null, 2),
      'borders.geojson': JSON.stringify(bordersGeoJson(topo, p.assignment, state.seats)),
      'districts.geojson': JSON.stringify(districtsGeoJson(topo, p.assignment, state.seats)),
      'cuts.geojson': JSON.stringify(cutsGeoJson(split.cuts)),
    });
  }
  await write('', {
    'bridges.json': JSON.stringify(bridgesJson(topo, blocks)),
    'balance.json': JSON.stringify(balanceLog(balanced.moves, before.districts.map((d) => d.pop))),
    // Debug only, not published: what each cut's search saw.
    'cut-stats.json': JSON.stringify({ threads: config.threads, cuts: split.cuts.map(cutStats) }, null, 1),
    'candidates.json': JSON.stringify(candidateRows(split.cuts)),
  });
  return {
    state: state.abbr, status: 'ok', seats: state.seats, blocks: blocks.length,
    rangePersons: official.rangePersons, rangePct: Number(official.rangePct.toFixed(4)),
    beforeBalancingRange: before.rangePersons, contiguous: official.allContiguous,
    cutsSkipped: common.cutsSkipped, strayPop: common.strayPopMoved, recounts: common.recounts, balanceMoves: balanced.moves.length,
    countiesSplit: `${official.countiesSplit}/${official.countiesTotal}`, runtimeMs,
    sha256: official.assignmentSha256.slice(0, 12),
  };
}

async function main(): Promise<void> {
  const config = parseConfig(process.argv.slice(2));
  const summary: Record<string, unknown>[] = [];
  let firstError: unknown;
  // Everything this run executes; a change to any of it redraws every state.
  const codeSha256 = exploreCodeSha256();
  const slot = new PoolSlot(config.threads);
  for (const state of config.states) {
    // A worker that died while idle between states must not fail this one; a no-op unless the pool is broken.
    slot.refresh();
    try {
      const dir = join(config.outDir, state.abbr);
      const key = runKeyFor(state, codeSha256);
      let row: Record<string, unknown> = {};
      const outcome = await drawOrSkip(
        { dir, key, force: config.force, writeDir: writePlan, onDraw: (why) => console.log(`${state.abbr}: drawing (${why})`) },
        async (write) => { row = await drawState(state, config, slot, write); },
      );
      summary.push(outcome === 'skipped' ? { state: state.abbr, status: 'unchanged, skipped (--force redraws it)', seats: state.seats } : row);
    } catch (err) {
      firstError ??= err;
      summary.push({ state: state.abbr, status: err instanceof Error ? err.message : String(err), seats: state.seats });
      // A lost worker breaks the pool; the next state gets a fresh one (or one thread) so the run continues.
      slot.refresh();
    }
  }
  await slot.close().catch(() => undefined);
  console.table(summary);
  if (firstError !== undefined) throw firstError;
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(exitCodeFor(err));
});
