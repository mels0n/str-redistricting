import { isConnected, type Block, type Topology } from '../../entities/census-block/index.js';

export interface BalanceResult {
  readonly assignment: Int32Array;
  readonly moves: number;
}

interface Move { block: number; from: number; to: number; gain: number }

export function balance(blocks: readonly Block[], topo: Topology, input: Int32Array, seats: number): BalanceResult {
  const assignment = Int32Array.from(input);
  const pop = new Float64Array(seats);
  blocks.forEach((b, i) => { pop[assignment[i]!]! += b.pop; });
  const ideal = pop.reduce((s, x) => s + x, 0) / seats;
  // Member lists are cached per district within one outer iteration and cleared after a move.
  const memberCache = new Map<number, Int32Array>();
  const members = (d: number): Int32Array => {
    let m = memberCache.get(d);
    if (!m) {
      m = Int32Array.from([...assignment.keys()].filter((i) => assignment[i] === d));
      memberCache.set(d, m);
    }
    return m;
  };

  let moves = 0;
  const exhausted = new Uint8Array(seats);
  for (;;) {
    let d = -1;
    for (let k = 0; k < seats; k++) {
      if (exhausted[k]) continue;
      if (d === -1 || Math.abs(pop[k]! - ideal) > Math.abs(pop[d]! - ideal)) d = k;
    }
    if (d === -1) break;

    const seen = new Set<string>();
    const cands: Move[] = [];
    const consider = (block: number, from: number, to: number) => {
      const p = blocks[block]!.pop;
      const key = `${block}:${to}`;
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
      moves++;
      memberCache.clear();
      moved = true;
      break;
    }
    if (moved) exhausted.fill(0); else exhausted[d] = 1;
  }
  return { assignment, moves };
}
