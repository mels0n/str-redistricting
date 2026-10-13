import { z } from 'zod';
import type { BlockPolygons } from '../../entities/census-block/index.js';
import { BalanceLogSchema, type BalanceLog } from '../../entities/plan-output/index.js';
import { DataError } from '../../shared/errors/index.js';

export { BalanceLogSchema };
export type { BalanceLog };

/** The process numbers every plan's metrics.json reports; they pass through to stats.json. */
export const ProcessNumbersSchema = z.object({
  population: z.number().int().nonnegative(),
  ideal: z.number().positive(),
  rangePersons: z.number().nonnegative(),
  rangePct: z.number().nonnegative(),
  assignmentSha256: z.string().regex(/^[0-9a-f]{64}$/),
  cuts: z.number().int().nonnegative(),
  candidateRangesPerCut: z.array(z.number().int().positive()),
  candidateRangesEvaluated: z.number().int().nonnegative(),
  strayBlocksMoved: z.number().int().nonnegative(),
  strayPopMoved: z.number().int().nonnegative(),
  recounts: z.number().int().nonnegative(),
  recountsMaxPerCut: z.number().int().nonnegative(),
  balanceMoves: z.number().int().nonnegative(),
  peopleMovedByBalancing: z.number().int().nonnegative(),
  rangeBeforeBalancing: z.number().nonnegative(),
  rangeAfterBalancing: z.number().nonnegative(),
  runtimeMs: z.number().nonnegative(),
  countiesSplit: z.number().int().nonnegative(),
  countiesTotal: z.number().int().nonnegative(),
  blocks: z.number().int().nonnegative(),
});

/** The two published counts of balancing moves that only shortened the border (gain exactly 0). */
export const BorderOnlyMovesSchema = z.object({
  balanceMovesBorderOnly: z.number().int().nonnegative(),
  peopleMovedBorderOnly: z.number().int().nonnegative(),
});
export type BorderOnlyMoves = z.infer<typeof BorderOnlyMovesSchema>;

/** No moves, so none that only shortened the border: the before-balancing plan. */
export const NO_BORDER_ONLY_MOVES: BorderOnlyMoves = { balanceMovesBorderOnly: 0, peopleMovedBorderOnly: 0 };

/** The moves with gain 0 in a balance log (they leave the districts exactly as close and shorten the border), and the people they carried. */
export function borderOnlyMoves(log: BalanceLog): BorderOnlyMoves {
  const only = log.moves.filter((m) => m.gain === 0);
  return BorderOnlyMovesSchema.parse({ balanceMovesBorderOnly: only.length, peopleMovedBorderOnly: only.reduce((sum, m) => sum + m.pop, 0) });
}

const round6 = (x: number): number => Math.round(x * 1e6) / 1e6;

export interface PublishedBalance {
  /** District populations before the first move, index 0 = district 1. */
  readonly before: readonly number[];
  readonly moves: readonly { order: number; geoid: string; from: number; to: number; pop: number; gain: number }[];
  /** Polygons of the moved blocks by GEOID: polygons, then rings, then [lon, lat], unsimplified. */
  readonly blocks: Record<string, number[][][][]>;
}

/** balance.json for the viewer: the moves in order plus each moved block's outline (once, even if it moved twice). */
export function buildBalance(seats: number, log: BalanceLog, polygons: ReadonlyMap<string, BlockPolygons>): PublishedBalance {
  if (log.before.length !== seats) throw new DataError(`balance log has ${log.before.length} districts, expected ${seats}`);
  const blocks: Record<string, number[][][][]> = {};
  const moves = log.moves.map((m, i) => {
    if (m.from > seats || m.to > seats || m.from === m.to) throw new DataError(`balance move ${i + 1}: bad districts ${m.from} -> ${m.to}`);
    if (!(m.geoid in blocks)) {
      const polys = polygons.get(m.geoid);
      if (polys === undefined) throw new DataError(`balance move ${i + 1}: no polygon for block ${m.geoid}`);
      blocks[m.geoid] = polys.map((poly) => poly.map((ring) => ring.map((pt) => [round6(pt[0]), round6(pt[1])])));
    }
    return { order: i + 1, geoid: m.geoid, from: m.from, to: m.to, pop: m.pop, gain: m.gain };
  });
  return { before: log.before, moves, blocks };
}
