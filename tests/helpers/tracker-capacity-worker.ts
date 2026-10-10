import { parentPort } from 'node:worker_threads';
import { selectLow } from '../../src/server/features/splitline/scan.js';
import { directionAt, geoFor } from '../../src/server/features/splitline/sweep.js';
import { Tracker } from '../../src/server/features/splitline/tracker.js';

/**
 * Test stand-in for one chain pass: a tracker built over two free blocks of a six-block piece (as a spare is, after
 * its pass was dropped) and then reconfigured to hold all six. Runs on its own thread so a tracker that never returns
 * can be given up on. Posts the heaps it ended with.
 */
const m = 6;
const px = Float64Array.from([0, 1, 2, 3, 4, 5]), py = Float64Array.from([0, 0.1, 0.3, 0.2, 0.5, 0.4]);
const pops = Float64Array.from([1, 1, 1, 1, 1, 1]);
const piece = { m, ids: Int32Array.from([0, 1, 2, 3, 4, 5]), pops, total: 6, px, py, lOff: new Int32Array(m + 1), lAdj: new Int32Array(0), lLen: new Float64Array(0) };
const geo = geoFor(piece, directionAt(0), directionAt(180), true);

const countFor = (T: number, minC: number, maxC: number) => (free: Int32Array, ux: number, uy: number): number => {
  const n = free.length, keys = new Float64Array(n), ids = new Int32Array(n), p = new Float64Array(n), perm = new Int32Array(n);
  for (let i = 0; i < n; i++) { const x = free[i]!; keys[i] = px[x]! * uy - py[x]! * ux; ids[i] = x; p[i] = pops[x]!; }
  const count = selectLow(keys, ids, p, perm, T, minC, maxC);
  free.set(Int32Array.from(perm, (i) => free[i]!));
  return count;
};

const tr = new Tracker(geo, m, Int32Array.from([0, 1]), 1, 1, 1, -4, -2, countFor(1, 1, 1));
tr.reconfigure(new Int8Array(m).fill(-1), 3, 1, 5, -4, -2);
const heaps = tr as unknown as { hA: Int32Array; hB: Int32Array };
parentPort!.postMessage({ nA: tr.nA, nB: tr.nB, hA: Array.from(heaps.hA.slice(0, tr.nA)), hB: Array.from(heaps.hB.slice(0, tr.nB)) });
