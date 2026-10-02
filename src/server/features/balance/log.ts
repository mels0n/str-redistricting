import type { BalanceMove } from './balance.js';

/** The balancing pass as written to out/<ST>/balance.json: districts are 1-based, like assignment.csv. */
export interface BalanceLog {
  /** District populations before the first move. */
  readonly before: readonly number[];
  readonly moves: readonly BalanceMove[];
}

export function balanceLog(moves: readonly BalanceMove[], before: readonly number[]): BalanceLog {
  return { before: [...before], moves: moves.map((m) => ({ block: m.block, geoid: m.geoid, from: m.from + 1, to: m.to + 1, pop: m.pop, gain: m.gain })) };
}

/** Total population of the blocks balancing moved. */
export const peopleMoved = (moves: readonly BalanceMove[]): number => moves.reduce((s, m) => s + m.pop, 0);
