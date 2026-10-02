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
