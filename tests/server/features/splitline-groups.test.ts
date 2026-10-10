import { describe, expect, it } from 'vitest';
import { Groups } from '../../../src/server/features/splitline/groups.js';
import type { Piece } from '../../../src/server/features/splitline/scan.js';
import { gridBlocks } from '../../helpers/grid.js';
import { pieceOf } from '../../helpers/piece.js';

/** A small deterministic generator, so a failure reproduces. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

/** Ragged grids with uneven populations and holes. */
const pieces = (): Piece[] => [
  pieceOf(gridBlocks(6, 5, { pop: (x, y) => 1 + ((x * 7 + y * 13) % 11) })),
  pieceOf(gridBlocks(7, 6, { pop: (x, y) => (x + y) % 4, skip: (x, y) => (x > 1 && x < 4 && y > 0 && y < 4) || (y === 5 && x > 3) })),
  pieceOf(gridBlocks(9, 3, { pop: (x) => 2 + (x % 3), skip: (x, y) => y === 1 && x % 3 === 1 })),
];

/** What each group looks like from outside, keyed by its blocks: the label it carries does not matter. */
function summary(g: Groups, piece: Piece) {
  const members = new Map<number, number[]>();
  for (let b = 0; b < piece.m; b++) members.set(g.label[b]!, [...(members.get(g.label[b]!) ?? []), b]);
  const out = new Map<string, { pop: number; cnt: number; minId: number; side: number; pin: number; zob: [number, number] }>();
  for (const [c, bs] of members) {
    out.set(bs.join(','), { pop: g.pop[c]!, cnt: g.cnt[c]!, minId: g.minId[c]!, side: g.side[c]!, pin: g.pin[c]!, zob: [g.zobX[c]!, g.zobY[c]!] });
  }
  return out;
}

/** Edge count and total length between the groups of blocks i and j, for every pair of blocks in different groups. */
function edges(g: Groups, piece: Piece) {
  const out = new Map<string, { n: number; len: number }>();
  for (let i = 0; i < piece.m; i++) {
    for (let j = i + 1; j < piece.m; j++) {
      const ci = g.label[i]!, cj = g.label[j]!;
      if (ci === cj) continue;
      const e = g.nbr[ci]!.get(cj);
      out.set(`${i}-${j}`, { n: e?.n ?? 0, len: e?.len ?? 0 });
    }
  }
  return out;
}

/** The groups must be exactly those of a fresh build over the same classes. */
function expectSameAsFresh(g: Groups, piece: Piece, side: Uint8Array, pin: Uint8Array): void {
  g.resolveMins();
  const fresh = new Groups(piece, Uint8Array.from(side), Uint8Array.from(pin));
  fresh.buildAll();
  // The same partition of the blocks, whatever the labels.
  for (let i = 0; i < piece.m; i++) {
    expect(g.label[i], `block ${i} has a group`).toBeGreaterThanOrEqual(0);
    for (let j = i + 1; j < piece.m; j++) expect(g.label[i] === g.label[j], `blocks ${i} and ${j}`).toBe(fresh.label[i] === fresh.label[j]);
  }
  // Per group: population, block count, lowest block id (after resolveMins), class and the hashes of the member sets.
  expect(summary(g, piece)).toEqual(summary(fresh, piece));
  let alive = 0, freshAlive = 0;
  for (let c = 0; c < g.cap; c++) alive += g.alive[c]!;
  for (let c = 0; c < fresh.cap; c++) freshAlive += fresh.alive[c]!;
  expect(alive).toBe(freshAlive);
  // The border between every two groups: edge counts and exact lengths.
  expect(edges(g, piece)).toEqual(edges(fresh, piece));
}

describe('Groups', () => {
  it('stays the same as a fresh build after every random change of class', () => {
    const rnd = lcg(31);
    for (const piece of pieces()) {
      const side = new Uint8Array(piece.m), pin = new Uint8Array(piece.m);
      for (let i = 0; i < piece.m; i++) { side[i] = rnd() < 0.5 ? 0 : 1; pin[i] = rnd() < 0.25 ? 1 : 0; }
      const g = new Groups(piece, side, pin);
      g.buildAll();
      expectSameAsFresh(g, piece, side, pin);
      for (let step = 0; step < 250; step++) {
        const x = Math.floor(rnd() * piece.m);
        g.remove(x);
        // Change the side, the pin, or both.
        const r = rnd();
        if (r < 0.5) side[x] = side[x]! ^ 1; else if (r < 0.8) pin[x] = pin[x]! ^ 1; else { side[x] = side[x]! ^ 1; pin[x] = pin[x]! ^ 1; }
        g.add(x);
        expectSameAsFresh(g, piece, side, pin);
      }
    }
  });

  it('handles a block that leaves and rejoins its own class, and a run of changes before any check', () => {
    const rnd = lcg(32);
    const piece = pieceOf(gridBlocks(8, 6, { pop: (x, y) => 1 + ((x + 2 * y) % 5), skip: (x, y) => x === 3 && y > 0 && y < 5 }));
    const side = new Uint8Array(piece.m), pin = new Uint8Array(piece.m);
    for (let i = 0; i < piece.m; i++) side[i] = piece.px[i]! < 0.04 ? 0 : 1;
    const g = new Groups(piece, side, pin);
    g.buildAll();
    for (let x = 0; x < piece.m; x++) { g.remove(x); g.add(x); }
    expectSameAsFresh(g, piece, side, pin);
    for (let step = 0; step < 40; step++) {
      for (let k = 0; k < 6; k++) {
        const x = Math.floor(rnd() * piece.m);
        g.remove(x); side[x] = side[x]! ^ 1; g.add(x);
      }
      expectSameAsFresh(g, piece, side, pin);
    }
  });

  it('splits a group exactly when removing a block cuts it, and merges when a block joins', () => {
    // A row of five blocks, all one class: the middle one leaving splits it in two; coming back (same class) joins them.
    const piece = pieceOf(gridBlocks(5, 1, { pop: () => 1 }));
    const side = new Uint8Array(5), pin = new Uint8Array(5);
    const g = new Groups(piece, side, pin);
    g.buildAll();
    expect(new Set(g.label).size).toBe(1);
    g.remove(2); side[2] = 1; g.add(2);
    expect(new Set(Array.from(g.label)).size).toBe(3);
    expect(g.label[0]).toBe(g.label[1]);
    expect(g.label[3]).toBe(g.label[4]);
    expect(g.label[0]).not.toBe(g.label[3]);
    g.remove(2); side[2] = 0; g.add(2);
    expect(new Set(Array.from(g.label)).size).toBe(1);
    expectSameAsFresh(g, piece, side, pin);
  });

  it('a clone follows the same changes as the original, and the two do not disturb each other', () => {
    const rnd = lcg(33);
    for (const piece of pieces()) {
      const side = new Uint8Array(piece.m), pin = new Uint8Array(piece.m);
      for (let i = 0; i < piece.m; i++) { side[i] = rnd() < 0.5 ? 0 : 1; pin[i] = rnd() < 0.2 ? 1 : 0; }
      const g = new Groups(piece, side, pin);
      g.buildAll();
      for (let step = 0; step < 30; step++) { const x = Math.floor(rnd() * piece.m); g.remove(x); side[x] = side[x]! ^ 1; g.add(x); }
      const side2 = Uint8Array.from(side), pin2 = Uint8Array.from(pin);
      const copy = g.clone(side2, pin2);
      expectSameAsFresh(copy, piece, side2, pin2);
      // Drive them apart with different changes; each stays equal to a fresh build of its own classes.
      for (let step = 0; step < 60; step++) {
        const x = Math.floor(rnd() * piece.m), y = Math.floor(rnd() * piece.m);
        g.remove(x); side[x] = side[x]! ^ 1; g.add(x);
        copy.remove(y); pin2[y] = pin2[y]! ^ 1; copy.add(y);
        expectSameAsFresh(g, piece, side, pin);
        expectSameAsFresh(copy, piece, side2, pin2);
      }
    }
  });

  it('reports the blocks whose group changed as touched, and clears them', () => {
    const piece = pieceOf(gridBlocks(4, 1, { pop: () => 1 }));
    const side = new Uint8Array(4), pin = new Uint8Array(4);
    const g = new Groups(piece, side, pin);
    g.buildAll();
    g.clearTouched();
    g.remove(1); side[1] = 1; g.add(1);
    expect(g.touched).toContain(1);
    // Block 0 is cut off from 2 and 3 by the removal: the pieces that broke away are touched.
    expect(g.touched.length).toBeGreaterThanOrEqual(2);
    g.clearTouched();
    expect(g.touched).toEqual([]);
  });
});
