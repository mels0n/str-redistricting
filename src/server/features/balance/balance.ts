import { isConnected, type Block, type Topology } from '../../entities/census-block/index.js';

/** One accepted balancing move: block index, its GEOID, 0-based districts, the block's population and the exact gain. */
export interface BalanceMove {
  readonly block: number;
  readonly geoid: string;
  readonly from: number;
  readonly to: number;
  readonly pop: number;
  /** Exact decrease in the sum of squared district deviations. */
  readonly gain: number;
}

export interface BalanceResult {
  readonly assignment: Int32Array;
  /** Every accepted move, in the order made. */
  readonly moves: readonly BalanceMove[];
}

interface Move { block: number; from: number; to: number; gain: number }

export function balance(blocks: readonly Block[], topo: Topology, input: Int32Array, seats: number): BalanceResult {
  const assignment = Int32Array.from(input);
  const pop = new Float64Array(seats);
  blocks.forEach((b, i) => { pop[assignment[i]!]! += b.pop; });
  const ideal = pop.reduce((s, x) => s + x, 0) / seats;
  // Ascending member list per district, built once and updated in place on every move.
  const lists: number[][] = Array.from({ length: seats }, () => []);
  for (let i = 0; i < assignment.length; i++) lists[assignment[i]!]!.push(i);
  const members = (d: number): readonly number[] => lists[d]!;
  /** Position of `block` in an ascending list, or where it would be inserted. */
  const lowerBound = (list: readonly number[], block: number): number => {
    let lo = 0, hi = list.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (list[mid]! < block) lo = mid + 1; else hi = mid; }
    return lo;
  };

  const moves: BalanceMove[] = [];
  const exhausted = new Uint8Array(seats);
  for (;;) {
    let d = -1;
    for (let k = 0; k < seats; k++) {
      if (exhausted[k]) continue;
      if (d === -1 || Math.abs(pop[k]! - ideal) > Math.abs(pop[d]! - ideal)) d = k;
    }
    if (d === -1) break;

    const seen = new Set<number>();
    const cands: Move[] = [];
    const consider = (block: number, from: number, to: number) => {
      const p = blocks[block]!.pop;
      const key = block * seats + to;
      if (p === 0 || seen.has(key)) return;
      seen.add(key);
      // Exact decrease in the sum of squared deviations (populations are integers).
      const gain = 2 * p * (pop[from]! - pop[to]! - p);
      if (gain > 0) cands.push({ block, from, to, gain });
    };
    // Only the border of district d: its blocks moving out, and neighbouring blocks moving in.
    for (const i of members(d)) {
      for (let k = topo.adjOffsets[i]!; k < topo.adjOffsets[i + 1]!; k++) {
        const j = topo.adjList[k]!;
        const e = assignment[j]!;
        if (e === d) continue;
        consider(i, d, e);
        consider(j, e, d);
      }
    }
    cands.sort((x, y) => y.gain - x.gain || x.block - y.block || x.to - y.to);

    let moved = false;
    for (const c of cands) {
      const rest = members(c.from).filter((i) => i !== c.block);
      if (rest.length === 0 || !isConnected(topo, Int32Array.from(rest))) continue;
      assignment[c.block] = c.to;
      pop[c.from]! -= blocks[c.block]!.pop;
      pop[c.to]! += blocks[c.block]!.pop;
      moves.push({ block: c.block, geoid: blocks[c.block]!.geoid, from: c.from, to: c.to, pop: blocks[c.block]!.pop, gain: c.gain });
      const fromList = lists[c.from]!, toList = lists[c.to]!;
      fromList.splice(lowerBound(fromList, c.block), 1);
      toList.splice(lowerBound(toList, c.block), 0, c.block);
      moved = true;
      break;
    }
    if (moved) exhausted.fill(0); else exhausted[d] = 1;
  }
  return { assignment, moves };
}
