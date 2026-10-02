/**
 * Example numbers for the worked examples on the How it works page. They are
 * illustrations, not any state's data; tests/client/how-examples.test.ts
 * checks every figure, and checks that the rules below agree with the
 * generator's own code.
 */

// ---------------------------------------------------------------------------
// One cut: walking along the ordered blocks to the first side's share

export interface SplitBlock {
  readonly name: string;
  readonly people: number;
}

/** A 2-seat piece, its blocks already in order across the guide line. */
export const SPLIT_EXAMPLE = {
  seats: 2,
  lowSeats: 1,
  blocks: [
    { name: 'A', people: 120 },
    { name: 'B', people: 90 },
    { name: 'C', people: 160 },
    { name: 'D', people: 70 },
    { name: 'E', people: 100 },
    { name: 'F', people: 130 },
    { name: 'G', people: 150 },
    { name: 'H', people: 180 },
  ] as readonly SplitBlock[],
} as const;

export interface SplitWalk {
  /** People in the whole piece. */
  readonly total: number;
  /** The first side's share: total × its seats ÷ the piece's seats. */
  readonly share: number;
  /** Running total after each block. */
  readonly running: readonly number[];
  /** Index of the block that carries the running total to or past the share. */
  readonly crossing: number;
  /** Running totals when stopping just before and just after that block. */
  readonly before: number;
  readonly after: number;
  /** Blocks on the first side. */
  readonly count: number;
}

/**
 * The cut rule's walk: add up people in order until the total reaches the
 * share, then stop just before or just after that block, whichever is closer;
 * a tie stops just before. Each side keeps at least one block.
 */
export function walkSplit(people: readonly number[], seats: number, lowSeats: number): SplitWalk {
  const total = people.reduce((s, p) => s + p, 0);
  const share = (total * lowSeats) / seats;
  const running: number[] = [];
  let cum = 0;
  let crossing = -1;
  let before = 0;
  let after = 0;
  let count = people.length;
  for (let i = 0; i < people.length; i++) {
    const next = cum + people[i]!;
    running.push(next);
    if (crossing === -1 && next >= share) {
      crossing = i;
      before = cum;
      after = next;
      count = Math.abs(next - share) < Math.abs(cum - share) ? i + 1 : i;
    }
    cum = next;
  }
  return { total, share, running, crossing, before, after, count: Math.min(people.length - 1, Math.max(1, count)) };
}

// ---------------------------------------------------------------------------
// Stray pieces and the re-count

/**
 * A 2-seat piece in order across the guide line: the West blocks, then T (the
 * last block whose center is on the first side), then a small block whose
 * center is just past the line but which sits inside a large West block, then
 * the East blocks.
 */
export const RECOUNT_EXAMPLE = {
  seats: 2,
  lowSeats: 1,
  island: 'Island',
  blocks: [
    { name: 'West', people: 470 },
    { name: 'T', people: 30 },
    { name: 'Island', people: 30 },
    { name: 'East', people: 470 },
  ] as readonly SplitBlock[],
} as const;

export interface Recount {
  /** The first side's share of the people. */
  readonly share: number;
  /** People on the first side after the walk by centers, before the island moves. */
  readonly firstWalk: number;
  /** People in the island. */
  readonly island: number;
  /** The block the re-count hands back to the second side, if any. */
  readonly crossesBack: string | undefined;
  /** People on each side once the island has joined the first side and the walk is redone. */
  readonly low: number;
  readonly high: number;
}

/**
 * The re-count for the example: the island joins the first side and stays
 * there, and the walk is redone over the other blocks with the island's
 * people already counted on the first side. Same stopping rule as walkSplit.
 */
export function recountExample(): Recount {
  const { blocks, seats, lowSeats, island } = RECOUNT_EXAMPLE;
  const first = walkSplit(blocks.map((b) => b.people), seats, lowSeats);
  const firstWalk = first.running[first.count - 1]!;
  const fixed = blocks.find((b) => b.name === island)!.people;
  const free = blocks.filter((b) => b.name !== island);
  const target = first.share - fixed;
  let cum = 0;
  let count = free.length - 1;
  for (let i = 0; i < free.length; i++) {
    const next = cum + free[i]!.people;
    if (next >= target) {
      count = Math.abs(next - target) < Math.abs(cum - target) ? i + 1 : i;
      break;
    }
    cum = next;
  }
  // The first side already holds the island, so it may keep no free block; the second side keeps at least one.
  count = Math.min(free.length - 1, count);
  const low = fixed + free.slice(0, count).reduce((s, b) => s + b.people, 0);
  const crossesBack = blocks.findIndex((b) => b.name === island) >= first.count ? free.slice(count).find((b) => blocks.indexOf(b) < first.count)?.name : undefined;
  return { share: first.share, firstWalk, island: fixed, crossesBack, low, high: first.total - low };
}

/** Two lines for the same piece: one strands a big region, one strands nothing. Border lengths in km. */
export const STRANDED_EXAMPLE = {
  stranded: { people: 41_000, km: 35 },
  clean: { km: 30 },
} as const;

// ---------------------------------------------------------------------------
// One cut: comparing directions

/** Three of the 1,800 directions for one piece, with example border lengths. */
export const DIRECTION_EXAMPLE = [
  { angle: 0, km: 123 },
  { angle: 60, km: 101 },
  { angle: 120, km: 79 },
] as const;

// ---------------------------------------------------------------------------
// Balancing: choosing the next block

/** People above (+) or below (−) an even split, by district number. */
export type Deviations = Readonly<Record<number, number>>;

export interface Trade {
  readonly id: string;
  readonly people: number;
  readonly from: number;
  readonly to: number;
}

/** District 3 is furthest from even; its three trades that help. Every other district is already even. */
export const BALANCE_EXAMPLE: { readonly start: Deviations; readonly trades: readonly Trade[] } = {
  start: { 1: -300, 3: 400, 5: -100 },
  trades: [
    { id: 'A', people: 250, from: 3, to: 1 },
    { id: 'B', people: 300, from: 3, to: 1 },
    { id: 'C', people: 120, from: 3, to: 5 },
  ],
};

/** The sum of squared distances from the ideal. */
export function sumOfSquares(dev: Deviations): number {
  return Object.values(dev).reduce((s, d) => s + d * d, 0);
}

export function applyTrade(dev: Deviations, t: Trade): Deviations {
  return { ...dev, [t.from]: (dev[t.from] ?? 0) - t.people, [t.to]: (dev[t.to] ?? 0) + t.people };
}

/**
 * How much a trade lowers the sum of squares, as the generator computes it:
 * 2 × people × (giver − receiver − people). Only the two districts in the
 * trade change, so this is the whole state's improvement.
 */
export function improvement(dev: Deviations, t: Trade): number {
  return 2 * t.people * ((dev[t.from] ?? 0) - (dev[t.to] ?? 0) - t.people);
}

/** The district furthest from the ideal; a tie goes to the lower number. */
export function furthest(dev: Deviations): number {
  let best = -1;
  for (const k of Object.keys(dev).map(Number).sort((a, b) => a - b)) {
    if (best === -1 || Math.abs(dev[k]!) > Math.abs(dev[best]!)) best = k;
  }
  return best;
}

/** The best trade: the largest improvement (the example's trades are all allowed and their blocks distinct). */
export function bestTrade(dev: Deviations, trades: readonly Trade[]): Trade {
  return [...trades].filter((t) => improvement(dev, t) > 0).sort((a, b) => improvement(dev, b) - improvement(dev, a))[0]!;
}
