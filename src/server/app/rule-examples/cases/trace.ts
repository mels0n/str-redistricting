import type { Block, Topology } from '../../../entities/census-block/index.js';
import type { CutStats } from '../../../entities/plan-output/index.js';
import { chosenCandidate, pieceMembers, type ExtractContext, type StateOutput } from '../../../features/rule-examples/index.js';
import {
  createContext, findCut, ScanPool, type CandidateTrace, type CandidateTraceRequest, type CutResult, type SplitContext,
} from '../../../features/splitline/index.js';
import { DataError } from '../../../shared/errors/index.js';

/** One real cut re-run with some of its candidates traced. Block arrays hold block indices into `blocks`. */
export interface CutTrace {
  readonly abbr: string;
  readonly out: StateOutput;
  readonly cut: CutStats['cuts'][number];
  readonly blocks: readonly Block[];
  readonly topo: Topology;
  /** The generator's context for the whole state, projection included. */
  readonly split: SplitContext;
  /** The piece the cut splits. */
  readonly members: Int32Array;
  readonly result: CutResult;
  /** One per requested candidate, in request order. */
  readonly traces: readonly CandidateTrace[];
}

const splits = new WeakMap<ExtractContext, Map<string, Promise<SplitContext>>>();
const traced = new WeakMap<ExtractContext, Map<string, Promise<CutTrace>>>();

function cacheOf<T>(map: WeakMap<ExtractContext, Map<string, Promise<T>>>, ctx: ExtractContext): Map<string, Promise<T>> {
  let c = map.get(ctx);
  if (!c) { c = new Map(); map.set(ctx, c); }
  return c;
}

/** The generator's split context for a whole state, built once per extract run. */
export function splitContextOf(ctx: ExtractContext, abbr: string): Promise<SplitContext> {
  const cache = cacheOf(splits, ctx);
  let hit = cache.get(abbr);
  if (!hit) {
    hit = (async () => {
      const [out, sb] = await Promise.all([ctx.state(abbr), ctx.blocks(abbr)]);
      return createContext(sb.blocks, sb.topo);
    })();
    cache.set(abbr, hit);
  }
  return hit;
}

/**
 * A candidate to trace: a first-side seat count at the cut's own drawn direction, or any direction and seat count.
 * A range of directions is traced at an angle strictly inside it (its middle), which gives that range's sides.
 */
export type TraceAsk = number | CandidateTraceRequest;

/**
 * Re-run cut `order` (1-based) of a state exactly as the generator did, tracing the given candidates: a number is
 * a first-side seat count at the cut's drawn direction (the middle of its winning range) (default: the seat count the cut chose). Fails if the
 * re-run does not reproduce the cut on disk, so a stale out/ never ships.
 */
export function cutTrace(ctx: ExtractContext, abbr: string, order: number, lowSeats?: readonly TraceAsk[]): Promise<CutTrace> {
  const cache = cacheOf(traced, ctx);
  const key = `${abbr}:${order}:${lowSeats?.map((l) => (typeof l === 'number' ? l : `${l.angleDeg}/${l.lowSeats}`)).join(',') ?? ''}`;
  let hit = cache.get(key);
  if (!hit) {
    hit = run(ctx, abbr, order, lowSeats);
    cache.set(key, hit);
  }
  return hit;
}

async function run(ctx: ExtractContext, abbr: string, order: number, lowSeats: readonly TraceAsk[] | undefined): Promise<CutTrace> {
  const out = await ctx.state(abbr);
  const at = out.cutStats.cuts.findIndex((c) => c.order === order);
  const cut = out.cutStats.cuts[at];
  if (!cut) throw new DataError(`${abbr}: no cut ${order} in cut-stats.json`);
  const chosen = chosenCandidate(out, at).lowSeats;
  if (chosen === undefined) throw new DataError(`${abbr}: candidates.json has no lowSeats column`);
  const lows = lowSeats ?? [chosen];
  const [sb, split] = await Promise.all([ctx.blocks(abbr), splitContextOf(ctx, abbr)]);
  const index = new Map(sb.blocks.map((b, i) => [b.geoid, i] as const));
  const members = Int32Array.from(pieceMembers(out.before, cut.firstDistrict, cut.seats), (g) => {
    const i = index.get(g);
    if (i === undefined) throw new DataError(`${abbr}: block ${g} of the plan is not in the census file`);
    return i;
  }).sort();
  const pool = ctx.cfg.threads > 1 ? new ScanPool(ctx.cfg.threads) : undefined;
  let result: CutResult;
  try {
    result = findCut(split, members, cut.seats, undefined, { pool, trace: lows.map((l) => (typeof l === 'number' ? { angleDeg: cut.angleDeg, lowSeats: l, reversed: cut.reversed === true && l === chosen } : l)) });
  } finally {
    await pool?.close();
  }
  if (result.fromDeg !== cut.fromDeg || result.toDeg !== cut.toDeg || result.reversed !== (cut.reversed === true) || Math.round(result.lengthM) !== Math.round(cut.lengthM)) {
    throw new DataError(`${abbr}: re-running cut ${order} gives ${result.fromDeg} to ${result.toDeg}° and ${result.lengthM} m, not the ${cut.fromDeg} to ${cut.toDeg}° and ${cut.lengthM} m on disk (stale out/?)`);
  }
  return { abbr, out, cut, blocks: sb.blocks, topo: sb.topo, split, members, result, traces: result.traces };
}
