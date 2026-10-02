import { z } from 'zod';
import type { MultiPolygon } from 'geojson';
import { dataUrl, fetchJson, DataShapeError, bboxOf, labelPoint, type LonLat } from '../../shared';
import type { Stats } from './model';
import { populationsAfter, type BalanceMove } from './replay';

const Ring = z.array(z.tuple([z.number(), z.number()])).min(4);

export const BalanceSchema = z.object({
  before: z.array(z.number().int().nonnegative()).min(1),
  moves: z.array(
    z.object({
      order: z.number().int().positive(),
      geoid: z.string().regex(/^\d{15}$/),
      from: z.number().int().positive(),
      to: z.number().int().positive(),
      pop: z.number().int().positive(),
      gain: z.number().positive(),
    }),
  ),
  blocks: z.record(z.string(), z.array(z.array(Ring).min(1)).min(1)),
});

/** One block the balancing moved, ready to draw over the district map. */
export interface MovedBlock {
  /** Feature id on the map: the block's position in `blocks`. */
  id: number;
  geoid: string;
  geometry: MultiPolygon;
  /** A point inside the block, for its marker. */
  label: LonLat;
  /** [west, south, east, north]. */
  bbox: [number, number, number, number];
}

/** A state's balancing pass, move by move. */
export interface BalanceLog {
  /** District populations before the first move; index 0 = district 1. */
  before: number[];
  moves: BalanceMove[];
  /** Every block that moved, once each, in the order each first moved. */
  blocks: MovedBlock[];
  blockByGeoid: Map<string, MovedBlock>;
}

const logs = new Map<string, Promise<BalanceLog>>();

/**
 * Loads a state's balancing log. It is large for big states (California's
 * runs to about 1 MB), so it is fetched only when the replay opens. The log is
 * checked against the state's numbers: it must start from the populations
 * before balancing and end on the finished map's populations.
 */
export function loadBalance(abbr: string, stats: Stats): Promise<BalanceLog> {
  let p = logs.get(abbr);
  if (!p) {
    const url = dataUrl(`${abbr}/balance.json`);
    p = fetchJson(url, BalanceSchema).then((raw) => {
      const moves = [...raw.moves].sort((a, b) => a.order - b.order);
      checkLog(url, raw.before, moves, stats);
      const blocks: MovedBlock[] = [];
      const blockByGeoid = new Map<string, MovedBlock>();
      for (const mv of moves) {
        if (blockByGeoid.has(mv.geoid)) continue;
        const coords = raw.blocks[mv.geoid];
        if (!coords) throw new DataShapeError(url, `no outline for block ${mv.geoid}`);
        const geometry: MultiPolygon = { type: 'MultiPolygon', coordinates: coords };
        const b = bboxOf([geometry])!;
        const block: MovedBlock = { id: blocks.length, geoid: mv.geoid, geometry, label: labelPoint(geometry), bbox: [b[0], b[1], b[2], b[3]] };
        blocks.push(block);
        blockByGeoid.set(mv.geoid, block);
      }
      return { before: raw.before, moves, blocks, blockByGeoid };
    });
    p.catch(() => logs.delete(abbr));
    logs.set(abbr, p);
  }
  return p;
}

/** The phases must join up: the log starts where the cuts ended and its last move lands on the finished map. */
export function checkLog(url: string, before: readonly number[], moves: readonly BalanceMove[], stats: Stats): void {
  const seats = stats.finished.metrics.seats;
  const popsOf = (ds: readonly { district: number; pop: number }[]): number[] => [...ds].sort((a, b) => a.district - b.district).map((d) => d.pop);
  const same = (a: readonly number[], b: readonly number[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);
  if (before.length !== seats) throw new DataShapeError(url, `expected ${seats} districts, found ${before.length}`);
  if (moves.length !== stats.finished.metrics.balanceMoves) throw new DataShapeError(url, `expected ${stats.finished.metrics.balanceMoves} moves, found ${moves.length}`);
  if (moves.some((m) => m.from > seats || m.to > seats || m.from === m.to)) throw new DataShapeError(url, 'a move names a district that does not exist');
  if (!same(before, popsOf(stats.beforeBalancing.districts))) throw new DataShapeError(url, 'does not start from the plan before balancing');
  if (!same(populationsAfter(before, moves, moves.length), popsOf(stats.finished.districts))) throw new DataShapeError(url, 'does not end on the finished map');
}
