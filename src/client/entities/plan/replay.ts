/**
 * The replay of a state's drawing, as one sequence in two phases: the cuts
 * (position k shows cuts 1..k, k = 0..C), then the balancing moves (position m
 * shows the plan after moves 1..m, m = 0..M). The cuts end on the plan before
 * balancing; balancing starts from that plan and its last move ends on the
 * finished map.
 */

/** One balancing move as published: districts are numbered from 1. */
export interface BalanceMove {
  /** 1-based position in the order the moves were made. */
  order: number;
  geoid: string;
  from: number;
  to: number;
  pop: number;
  gain: number;
}

export type SeqPos = { phase: 'cut'; k: number } | { phase: 'balance'; m: number };

/** Sizes of the two phases: C cuts and M balancing moves. */
export interface SeqSize {
  cuts: number;
  moves: number;
}

/** The last position in the sequence: the last balancing move, or the last cut when there was no balancing. */
export function seqLength(size: SeqSize): number {
  return size.moves > 0 ? size.cuts + 1 + size.moves : size.cuts;
}

/** Position in the whole sequence: cuts 0..C come first, then balancing 0..M. */
export function seqIndex(pos: SeqPos, size: SeqSize): number {
  return pos.phase === 'cut' ? clamp(pos.k, 0, size.cuts) : size.cuts + 1 + clamp(pos.m, 0, size.moves);
}

export function seqFromIndex(i: number, size: SeqSize): SeqPos {
  const n = clamp(Number.isFinite(i) ? Math.floor(i) : 0, 0, seqLength(size));
  return n <= size.cuts ? { phase: 'cut', k: n } : { phase: 'balance', m: n - size.cuts - 1 };
}

/** One step forward or back; stepping past the last cut opens the balancing, stepping back before it returns to the last cut. */
export function seqStep(pos: SeqPos, delta: number, size: SeqSize): SeqPos {
  return seqFromIndex(seqIndex(pos, size) + delta, size);
}

export function isSeqEnd(pos: SeqPos, size: SeqSize): boolean {
  return seqIndex(pos, size) >= seqLength(size);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** District populations (index 0 = district 1) after the first `m` moves, starting from the populations before balancing. */
export function populationsAfter(before: readonly number[], moves: readonly BalanceMove[], m: number): number[] {
  const pop = [...before];
  const n = clamp(m, 0, moves.length);
  for (let i = 0; i < n; i++) {
    const mv = moves[i]!;
    pop[mv.from - 1]! -= mv.pop;
    pop[mv.to - 1]! += mv.pop;
  }
  return pop;
}

/** Gap between the largest and smallest district. */
export function rangeOf(pops: readonly number[]): number {
  return pops.length ? Math.max(...pops) - Math.min(...pops) : 0;
}

/** What one move did, with every figure the readout prints. */
export interface MoveDetail {
  move: BalanceMove;
  /** Populations of the district it left and the one it joined, before and after the move. */
  fromBefore: number;
  fromAfter: number;
  toBefore: number;
  toAfter: number;
  /** Gap between those two districts, before and after the move. */
  gapBefore: number;
  gapAfter: number;
}

export function moveDetail(before: readonly number[], moves: readonly BalanceMove[], m: number): MoveDetail | null {
  if (m < 1 || m > moves.length) return null;
  const pre = populationsAfter(before, moves, m - 1);
  const move = moves[m - 1]!;
  const fromBefore = pre[move.from - 1]!;
  const toBefore = pre[move.to - 1]!;
  const fromAfter = fromBefore - move.pop;
  const toAfter = toBefore + move.pop;
  return {
    move,
    fromBefore,
    fromAfter,
    toBefore,
    toAfter,
    gapBefore: Math.abs(fromBefore - toBefore),
    gapAfter: Math.abs(fromAfter - toAfter),
  };
}

/** The district (1-based) each moved block belongs to after the first `m` moves; blocks not yet moved are absent. */
export function movedBlocksAt(moves: readonly BalanceMove[], m: number): Map<string, number> {
  const at = new Map<string, number>();
  const n = clamp(m, 0, moves.length);
  for (let i = 0; i < n; i++) at.set(moves[i]!.geoid, moves[i]!.to);
  return at;
}

/**
 * Milliseconds between moves when the balancing plays. A short log plays at
 * the base pace; a long one speeds up so the whole pass takes about
 * `totalMs`, never faster than `minMs` a move.
 */
export function balancePlayInterval(moves: number, opts: { baseMs: number; totalMs: number; minMs: number }): number {
  if (moves <= 0) return opts.baseMs;
  return Math.round(clamp(opts.totalMs / moves, opts.minMs, opts.baseMs));
}

/** One page of a long list: rows [start, end) of `total`, `size` to a page. */
export interface ListPage {
  page: number;
  pages: number;
  start: number;
  end: number;
}

/** The page of a paged list that holds row `index` (0-based). */
export function pageOf(index: number, total: number, size: number): ListPage {
  const pages = Math.max(1, Math.ceil(total / size));
  const page = clamp(Math.floor(Math.max(index, 0) / size), 0, pages - 1);
  return pageAt(page, total, size);
}

export function pageAt(page: number, total: number, size: number): ListPage {
  const pages = Math.max(1, Math.ceil(total / size));
  const p = clamp(page, 0, pages - 1);
  return { page: p, pages, start: p * size, end: Math.min(total, (p + 1) * size) };
}
