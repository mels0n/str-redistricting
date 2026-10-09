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

/** Why a border move was not allowed: the block has no people, the move would not narrow the gap, or the giving district would not stay one connected piece. */
export type MoveReason = 'no-people' | 'widens' | 'disconnects';

/** One move looked at in a round, with the generator's own verdict on it. Districts are 0-based. */
export interface RoundCandidate {
  readonly block: number;
  readonly from: number;
  readonly to: number;
  /** Exact decrease in the sum of squared district deviations; 0 for a block with no people. */
  readonly gain: number;
  readonly allowed: boolean;
  readonly reason?: MoveReason;
  /** The tried district on whose border the move was found. */
  readonly district: number;
}

/**
 * One round of the pass: the districts tried, furthest first, until one made a move (the last one tried) or none
 * could. `candidates` lists each tried district's moves: those that narrow the gap in the order they are ranked, then
 * the ones ruled out before ranking. Every candidate is checked, including those ranked after the move made.
 */
export interface BalanceRound {
  readonly furthest: number;
  readonly tried: readonly number[];
  readonly candidates: readonly RoundCandidate[];
}

export interface BalanceOptions {
  /** Observation only: called once per round; the result is the same with or without it. */
  onRound?(r: BalanceRound): void;
}

/**
 * Greedy population balancing of a district map: repeatedly move one border block from a district to a neighbour
 * while that lowers the sum of squared deviations from the ideal population. Deterministic, every tie is broken
 * by index.
 *
 * Each round takes the non-exhausted district furthest from the ideal population (ties to the lowest district
 * index: the strict `>` keeps the first). Candidates are the moves across that district's border, its blocks
 * moving out and neighbouring blocks moving in, kept only when the gain is positive, ranked by gain descending,
 * then block, then destination district. The first candidate that leaves the giving district connected (and
 * non-empty) is made. If none can be, that district is marked exhausted and the next furthest is tried. After any
 * move the exhausted marks are cleared, since populations and borders changed.
 *
 * It terminates: populations are integers, so a move's gain is a positive integer, the sum of squared deviations
 * is bounded below by 0 and strictly decreases with every move, so only finitely many moves exist; between
 * moves each district is exhausted at most once. The loop ends when every district is exhausted.
 */
export function balance(blocks: readonly Block[], topo: Topology, input: Int32Array, seats: number, opts: BalanceOptions = {}): BalanceResult {
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

  /** The giving district stays one connected piece (and keeps at least one block) without the block. */
  const leavesConnected = (c: Move): boolean => {
    const rest = members(c.from).filter((i) => i !== c.block);
    return rest.length > 0 && isConnected(topo, Int32Array.from(rest));
  };

  const moves: BalanceMove[] = [];
  const exhausted = new Uint8Array(seats);
  const observe = opts.onRound;
  let tried: number[] = [];
  let seenInRound: RoundCandidate[] = [];
  for (;;) {
    let d = -1;
    for (let k = 0; k < seats; k++) {
      if (exhausted[k]) continue;
      if (d === -1 || Math.abs(pop[k]! - ideal) > Math.abs(pop[d]! - ideal)) d = k;
    }
    if (d === -1) break;
    const district = d;

    const seen = new Set<number>();
    const cands: Move[] = [];
    const ruledOut: RoundCandidate[] | undefined = observe ? [] : undefined;
    const consider = (block: number, from: number, to: number) => {
      const p = blocks[block]!.pop;
      const key = block * seats + to;
      // Without an observer a block with no people is never a candidate, so skip it before any border work.
      if (p === 0 && !ruledOut) return;
      if (seen.has(key)) return;
      seen.add(key);
      if (p === 0) { ruledOut?.push({ block, from, to, gain: 0, allowed: false, reason: 'no-people', district }); return; }
      // Exact decrease in the sum of squared deviations (populations are integers). With a = pop[from], b = pop[to]
      // and ideal I, moving p changes (a-I)^2 + (b-I)^2 into (a-p-I)^2 + (b+p-I)^2; the difference is
      // 2p(a-I) - p^2 - 2p(b-I) - p^2 = 2p(a - b - p), so I cancels.
      const gain = 2 * p * (pop[from]! - pop[to]! - p);
      if (gain > 0) cands.push({ block, from, to, gain });
      else ruledOut?.push({ block, from, to, gain, allowed: false, reason: 'widens', district });
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

    let chosen = -1;
    for (let i = 0; i < cands.length; i++) {
      if (leavesConnected(cands[i]!)) { chosen = i; break; }
    }
    if (observe) {
      tried.push(d);
      cands.forEach((c, i) => {
        // Ranked ahead of the move made: the generator found them disconnecting. After it: checked here, the same way.
        const allowed = i === chosen || (chosen >= 0 && i > chosen && leavesConnected(c));
        seenInRound.push(allowed ? { ...c, allowed, district } : { ...c, allowed, reason: 'disconnects', district });
      });
      seenInRound.push(...ruledOut!);
    }
    if (chosen >= 0) {
      const c = cands[chosen]!;
      if (observe) { observe({ furthest: tried[0]!, tried, candidates: seenInRound }); tried = []; seenInRound = []; }
      assignment[c.block] = c.to;
      pop[c.from]! -= blocks[c.block]!.pop;
      pop[c.to]! += blocks[c.block]!.pop;
      moves.push({ block: c.block, geoid: blocks[c.block]!.geoid, from: c.from, to: c.to, pop: blocks[c.block]!.pop, gain: c.gain });
      const fromList = lists[c.from]!, toList = lists[c.to]!;
      fromList.splice(lowerBound(fromList, c.block), 1);
      toList.splice(lowerBound(toList, c.block), 0, c.block);
      exhausted.fill(0);
    } else exhausted[d] = 1;
  }
  if (observe) observe({ furthest: tried[0] ?? -1, tried, candidates: seenInRound });
  return { assignment, moves };
}
