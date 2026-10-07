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
