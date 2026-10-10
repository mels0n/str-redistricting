import { describe, expect, it } from 'vitest';
import { buildTopology, isConnected } from '../../../src/server/entities/census-block/index.js';
import { balance, balanceLog, peopleMoved, type BalanceRound } from '../../../src/server/features/balance/index.js';
import { gridBlocks } from '../../helpers/grid.js';

describe('balance', () => {
  it('moves a border block from the larger to the smaller district', () => {
    const blocks = gridBlocks(4, 1);
    const r = balance(blocks, buildTopology(blocks), Int32Array.from([0, 0, 0, 1]), 2);
    expect(Array.from(r.assignment)).toEqual([0, 0, 1, 1]);
    expect(r.moves).toHaveLength(1);
  });
  it('reduces imbalance and keeps every district connected', () => {
    const blocks = gridBlocks(5, 4, { pop: (x, y) => 1 + ((x * 3 + y * 5) % 4) });
    const topo = buildTopology(blocks);
    const start = Int32Array.from(blocks.map((_, i) => (i % 5 < 3 ? 0 : 1)));
    const spread = (a: Int32Array) => {
      const p = [0, 0];
      a.forEach((d, i) => { p[d]! += blocks[i]!.pop; });
      return Math.abs(p[0]! - p[1]!);
    };
    const r = balance(blocks, topo, start, 2);
    expect(spread(r.assignment)).toBeLessThan(spread(start));
    for (const d of [0, 1]) {
      const members = Int32Array.from([...r.assignment.keys()].filter((i) => r.assignment[i] === d));
      expect(isConnected(topo, members)).toBe(true);
    }
  });
  it('treats a zero-population block of the other district as a border: the block that touches only it can move', () => {
    // Block 1 (3 people, District 0) meets District 1 only through block 2, which holds nobody; block 3 holds the one person.
    const pops = [3, 3, 0, 1];
    const blocks = gridBlocks(4, 1, { pop: (x) => pops[x]! });
    const r = balance(blocks, buildTopology(blocks), Int32Array.from([0, 0, 1, 1]), 2);
    expect(r.moves.map((m) => m.block)).toEqual([1]);
    expect(Array.from(r.assignment)).toEqual([0, 1, 1, 1]);
  });
  it('leaves an already balanced plan alone', () => {
    const blocks = gridBlocks(2, 1);
    const r = balance(blocks, buildTopology(blocks), Int32Array.from([0, 1]), 2);
    expect(r.moves).toHaveLength(0);
  });
  it('makes no move whose exact gain is zero at large populations', () => {
    const pops = [700001, 300, 700001];
    const blocks = gridBlocks(3, 1, { pop: (x) => pops[x]! });
    const r = balance(blocks, buildTopology(blocks), Int32Array.from([0, 0, 1]), 2);
    expect(r.moves).toHaveLength(0);
    expect(Array.from(r.assignment)).toEqual([0, 0, 1]);
  });
  it('rejects a cut-vertex move and takes the best legal one', () => {
    const pops = [1, 3, 1, 0, 0, 0];
    const blocks = gridBlocks(3, 2, { pop: (x, y) => pops[y * 3 + x]! });
    const topo = buildTopology(blocks);
    const r = balance(blocks, topo, Int32Array.from([0, 0, 0, 1, 1, 1]), 2);
    expect(r.assignment[1]).toBe(0);
    expect(Array.from(r.assignment)).toEqual([1, 0, 1, 1, 1, 1]);
    expect(r.moves).toHaveLength(2);
    for (const d of [0, 1]) {
      const members = Int32Array.from([...r.assignment.keys()].filter((i) => r.assignment[i] === d));
      expect(isConnected(topo, members)).toBe(true);
    }
  });
  it('breaks a tie in gain by the shorter total border before GEOID order', () => {
    // 3x3 grid, District 1 is the right column's lower two blocks. Blocks 4 and 7 each hold one person and either may
    // leave District 0 with the same gain. Block 4 shares three edges with District 0 and one with District 1, so
    // moving it lengthens the border by about two edges; block 7 shares two and one, about one edge. Block 2 is
    // empty, so it never moves.
    const blocks = gridBlocks(3, 3, { pop: (x, y) => (x === 2 && y === 0 ? 0 : 1) });
    const topo = buildTopology(blocks);
    const rounds: BalanceRound[] = [];
    const r = balance(blocks, topo, Int32Array.from([0, 0, 0, 0, 0, 1, 0, 0, 1]), 2, { onRound: (x) => rounds.push(x) });
    const ranked = rounds[0]!.candidates.filter((c) => c.gain > 0);
    expect(ranked.map((c) => c.block)).toEqual([7, 4]);
    expect(ranked[0]!.gain).toBe(ranked[1]!.gain);
    expect(ranked[0]!.border!).toBeLessThan(ranked[1]!.border!);
    expect(r.moves[0]!.block).toBe(7);
  });
  it('breaks a tie in gain and border by GEOID order before the receiving district', () => {
    // 4x2 grid: District 1 is the left column, District 2 the right column, District 0 the four blocks between.
    // Blocks 2 and 5 can each leave District 0 with the same gain and exactly the same border change (each shares
    // one vertical and one horizontal edge with District 0 and one vertical edge with its receiver). Block 2 would
    // join District 2, whose first block is 3; block 5 would join District 1, whose first block is 0. Block 2 still
    // goes first: the block decides before the receiving district.
    const pops = [0, 0, 1, 0, 1, 1, 1, 1];
    const blocks = gridBlocks(4, 2, { pop: (x, y) => pops[y * 4 + x]! });
    const rounds: BalanceRound[] = [];
    const r = balance(blocks, buildTopology(blocks), Int32Array.from([1, 0, 0, 2, 1, 0, 0, 2]), 3, { onRound: (x) => rounds.push(x) });
    const ranked = rounds[0]!.candidates.filter((c) => c.gain > 0);
    const [b2, b5] = [ranked.find((c) => c.block === 2)!, ranked.find((c) => c.block === 5)!];
    expect(b2.gain).toBe(b5.gain);
    expect(b2.border).toBe(b5.border);
    expect(r.moves[0]).toMatchObject({ block: 2, from: 0, to: 2 });
  });
  it('sends a block to the neighbor whose first block comes first in GEOID order when everything else ties', () => {
    // 3x2 grid: District 2 is block 0, District 1 is block 2, District 0 the rest. Block 1 touches both one-block
    // districts along edges of the same length and both hold one person, so only the receiving district can decide.
    const pops = [1, 1, 1, 0, 3, 0];
    const blocks = gridBlocks(3, 2, { pop: (x, y) => pops[y * 3 + x]! });
    const r = balance(blocks, buildTopology(blocks), Int32Array.from([2, 0, 1, 0, 0, 0]), 3);
    expect(r.moves[0]).toMatchObject({ block: 1, from: 0, to: 2 });
  });
  it('gives a district that starts in two pieces the full connectivity check', () => {
    // 4x2 grid. District 0 is blocks 0, 4, 5 plus block 3, cut off from them by District 1 (1, 2, 6, 7).
    // Block 3 and block 5 tie on gain, and moving block 3 shortens the border more, so it ranks first. Block 3
    // has no neighbour in District 0, so a check that looks only around the block would call that move a split
    // and move block 5 instead; the full check sees the rest (0, 4, 5) is one piece and moves block 3.
    const pops = [3, 1, 1, 1, 1, 1, 1, 1];
    const blocks = gridBlocks(4, 2, { pop: (x, y) => pops[y * 4 + x]! });
    const topo = buildTopology(blocks);
    const r = balance(blocks, topo, Int32Array.from([0, 1, 1, 0, 0, 0, 1, 1]), 2);
    expect(r.moves[0]).toMatchObject({ block: 3, from: 0, to: 1 });
    for (const d of [0, 1]) {
      const members = Int32Array.from([...r.assignment.keys()].filter((i) => r.assignment[i] === d));
      expect(isConnected(topo, members)).toBe(true);
    }
  });
  it('tries equally far districts in the order of their first block, not their number', () => {
    // District 1 holds block 0 (5 people) and District 0 block 1 (1 person): both are 2 from the ideal of 3.
    const pops = [5, 1, 3];
    const blocks = gridBlocks(3, 1, { pop: (x) => pops[x]! });
    const rounds: BalanceRound[] = [];
    balance(blocks, buildTopology(blocks), Int32Array.from([1, 0, 2]), 3, { onRound: (x) => rounds.push(x) });
    expect(rounds[0]!.tried).toEqual([1, 0, 2]);
  });
  it('is deterministic and leaves its input untouched', () => {
    const blocks = gridBlocks(5, 4, { pop: (x, y) => 1 + ((x * 3 + y * 5) % 4) });
    const topo = buildTopology(blocks);
    const start = Int32Array.from(blocks.map((_, i) => (i % 5 < 3 ? 0 : 1)));
    const copy = Int32Array.from(start);
    const a = balance(blocks, topo, start, 2);
    const b = balance(blocks, topo, start, 2);
    expect(Array.from(a.assignment)).toEqual(Array.from(b.assignment));
    expect(a.moves).toEqual(b.moves);
    expect(Array.from(start)).toEqual(Array.from(copy));
  });
  it('records every accepted move in order with its block, districts, population and exact gain', () => {
    const pops = [1, 3, 1, 0, 0, 0];
    const blocks = gridBlocks(3, 2, { pop: (x, y) => pops[y * 3 + x]! });
    const r = balance(blocks, buildTopology(blocks), Int32Array.from([0, 0, 0, 1, 1, 1]), 2);
    expect(r.moves).toHaveLength(2);
    // Districts hold 5 and 0: moving a 1 down gains 2 * 1 * (5 - 0 - 1) = 8 (block 0 wins the tie), then the other 1 gains 2 * 1 * (4 - 1 - 1) = 4.
    expect(r.moves[0]).toEqual({ block: 0, geoid: blocks[0]!.geoid, from: 0, to: 1, pop: 1, gain: 8 });
    expect(r.moves[1]).toMatchObject({ block: 2, from: 0, to: 1, pop: 1, gain: 4 });
  });
  it('replaying the moves on the input gives the final assignment', () => {
    const blocks = gridBlocks(5, 4, { pop: (x, y) => 1 + ((x * 3 + y * 5) % 4) });
    const start = Int32Array.from(blocks.map((_, i) => (i % 5 < 3 ? 0 : 1)));
    const r = balance(blocks, buildTopology(blocks), start, 2);
    expect(r.moves.length).toBeGreaterThan(0);
    const replay = Int32Array.from(start);
    for (const m of r.moves) { expect(replay[m.block]).toBe(m.from); replay[m.block] = m.to; }
    expect(Array.from(replay)).toEqual(Array.from(r.assignment));
  });
});

describe('balance onRound', () => {
  const reasonOf = (r: BalanceRound, block: number, to: number) => r.candidates.find((c) => c.block === block && c.to === to);
  it('onRound does not change the result', () => {
    for (const [w, hh, pop, start] of [
      [5, 4, (x: number, y: number) => 1 + ((x * 3 + y * 5) % 4), (i: number) => (i % 5 < 3 ? 0 : 1)],
      [3, 2, (x: number, y: number) => [1, 3, 1, 0, 0, 0][y * 3 + x]!, (i: number) => (i < 3 ? 0 : 1)],
    ] as const) {
      const blocks = gridBlocks(w, hh, { pop });
      const topo = buildTopology(blocks);
      const input = Int32Array.from(blocks.map((_, i) => start(i)));
      const rounds: BalanceRound[] = [];
      const a = balance(blocks, topo, input, 2);
      const b = balance(blocks, topo, input, 2, { onRound: (r) => rounds.push(r) });
      expect(Array.from(b.assignment)).toEqual(Array.from(a.assignment));
      expect(b.moves).toEqual(a.moves);
      // One round per move, plus the last one that finds nothing.
      expect(rounds).toHaveLength(a.moves.length + 1);
    }
  });
  it('onRound does not change the result with 3 and 4 districts, ties and several moves', () => {
    const cases = [
      // 3 districts in column bands with equal populations everywhere, so many moves share the same gain.
      { w: 6, h: 3, seats: 3, pop: () => 1, start: (i: number) => (i % 6 < 4 ? 0 : i % 6 === 4 ? 1 : 2) },
      // 3 districts in row bands with uneven populations.
      { w: 5, h: 6, seats: 3, pop: (x: number, y: number) => 1 + ((x * 3 + y * 5) % 4), start: (i: number) => (Math.floor(i / 5) < 4 ? 0 : Math.floor(i / 5) < 5 ? 1 : 2) },
      // 4 districts as quadrants of a grid, the first holding most of the people.
      { w: 6, h: 6, seats: 4, pop: (x: number, y: number) => (x < 4 && y < 4 ? 3 : 1), start: (i: number) => (i % 6 < 3 ? 0 : 1) + (Math.floor(i / 6) < 3 ? 0 : 2) },
      // 4 districts in column bands with equal populations.
      { w: 8, h: 2, seats: 4, pop: () => 2, start: (i: number) => (i % 8 < 5 ? 0 : i % 8 < 6 ? 1 : i % 8 < 7 ? 2 : 3) },
    ];
    for (const { w, h, seats, pop, start } of cases) {
      const blocks = gridBlocks(w, h, { pop });
      const topo = buildTopology(blocks);
      const input = Int32Array.from(blocks.map((_, i) => start(i)));
      const rounds: BalanceRound[] = [];
      const a = balance(blocks, topo, input, seats);
      const b = balance(blocks, topo, input, seats, { onRound: (r) => rounds.push(r) });
      expect(Array.from(b.assignment)).toEqual(Array.from(a.assignment));
      expect(b.moves).toEqual(a.moves);
      // Not vacuous: the hook ran, and the pass made several moves.
      expect(rounds.length).toBeGreaterThan(0);
      expect(rounds).toHaveLength(a.moves.length + 1);
      expect(a.moves.length).toBeGreaterThanOrEqual(2);
      // Population ties: some round ranks two moves with the same positive gain.
      expect(rounds.some((r) => r.candidates.some((c, i) => c.gain > 0 && r.candidates.some((d, j) => j !== i && d.gain === c.gain)))).toBe(true);
    }
  });
  it('reports every candidate of a round with the check that ruled it out', () => {
    const pops = [1, 3, 1, 0, 0, 0];
    const blocks = gridBlocks(3, 2, { pop: (x, y) => pops[y * 3 + x]! });
    const rounds: BalanceRound[] = [];
    balance(blocks, buildTopology(blocks), Int32Array.from([0, 0, 0, 1, 1, 1]), 2, { onRound: (r) => rounds.push(r) });
    const [first, second] = rounds as [BalanceRound, BalanceRound];
    expect(first.furthest).toBe(0);
    expect(first.tried).toEqual([0]);
    // Block 1 holds the top row together; blocks 0 and 2 may go; the empty bottom row has no people.
    expect(reasonOf(first, 1, 1)).toMatchObject({ from: 0, gain: 12, allowed: false, reason: 'disconnects' });
    expect(reasonOf(first, 0, 1)).toMatchObject({ from: 0, gain: 8, allowed: true });
    expect(reasonOf(first, 2, 1)).toMatchObject({ from: 0, gain: 8, allowed: true });
    for (const b of [3, 4, 5]) expect(reasonOf(first, b, 0)).toMatchObject({ from: 1, allowed: false, reason: 'no-people' });
    expect(first.candidates.every((c) => c.allowed === (c.reason === undefined))).toBe(true);
    // Next round: 4 against 1. Moving the 3 would leave 1 against 4, no narrower; moving the 1 back would widen it.
    expect(reasonOf(second, 1, 1)).toMatchObject({ gain: 0, allowed: false, reason: 'widens' });
    expect(reasonOf(second, 0, 0)).toMatchObject({ from: 1, allowed: false, reason: 'widens' });
    expect(reasonOf(second, 2, 1)).toMatchObject({ gain: 4, allowed: true });
  });
  it('tries the next furthest district when the furthest has no allowed move', () => {
    // Three one-block districts: none can give its only block away, so every district is tried and the pass stops.
    const pops = [5, 1, 3];
    const blocks = gridBlocks(3, 1, { pop: (x) => pops[x]! });
    const rounds: BalanceRound[] = [];
    const r = balance(blocks, buildTopology(blocks), Int32Array.from([0, 1, 2]), 3, { onRound: (x) => rounds.push(x) });
    expect(r.moves).toHaveLength(0);
    expect(rounds).toHaveLength(1);
    expect(rounds[0]!.tried).toEqual([0, 1, 2]);
    expect(rounds[0]!.candidates.every((c) => !c.allowed)).toBe(true);
    // Each candidate names the district whose border it was found on.
    expect(new Set(rounds[0]!.candidates.map((c) => c.district))).toEqual(new Set([0, 1, 2]));
  });
});

describe('balanceLog', () => {
  const moves = [
    { block: 7, geoid: 'g7', from: 0, to: 2, pop: 40, gain: 900 },
    { block: 3, geoid: 'g3', from: 2, to: 1, pop: 5, gain: 80 },
  ];
  it('lists the moves in order with 1-based districts and keeps the starting populations', () => {
    expect(balanceLog(moves, [100, 60, 10])).toEqual({
      before: [100, 60, 10],
      moves: [
        { block: 7, geoid: 'g7', from: 1, to: 3, pop: 40, gain: 900 },
        { block: 3, geoid: 'g3', from: 3, to: 2, pop: 5, gain: 80 },
      ],
    });
  });
  it('sums the people the moves carried', () => {
    expect(peopleMoved(moves)).toBe(45);
    expect(peopleMoved([])).toBe(0);
  });
});
