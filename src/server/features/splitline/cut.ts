import { boundarySegments, isConnected } from '../../entities/census-block/index.js';
import { DataError } from '../../shared/errors/index.js';
import { greatCircleDistance, type LonLat } from '../../shared/geo/index.js';
import type { SplitContext } from './context.js';

export interface CutResult {
  readonly low: Int32Array;
  readonly high: Int32Array;
  readonly lowSeats: number;
  readonly highSeats: number;
  readonly angleDeg: number;
  readonly lengthM: number;
  readonly spans: readonly (readonly [LonLat, LonLat])[];
  readonly skipped: number;
}

export type SideValidator = (low: Int32Array, high: Int32Array) => boolean;

interface Candidate { k: number; lowSeats: number; count: number; offset: number; lengthM: number }

const RAD = Math.PI / 180;

/** Order local positions by (key, block id) and return the low-side count closest to the target population. */
function selectLow(keys: Float64Array, ids: Int32Array, pops: Float64Array, perm: Int32Array, target: number): number {
  const m = perm.length;
  for (let i = 0; i < m; i++) perm[i] = i;
  const less = (a: number, b: number) => keys[a]! < keys[b]! || (keys[a] === keys[b] && ids[a]! < ids[b]!);
  let lo = 0, hi = m, before = 0;
  for (;;) {
    if (hi - lo <= 16) {
      for (let i = lo + 1; i < hi; i++) {
        const v = perm[i]!; let j = i - 1;
        while (j >= lo && less(v, perm[j]!)) { perm[j + 1] = perm[j]!; j--; }
        perm[j + 1] = v;
      }
      let cum = before;
      for (let i = lo; i < hi; i++) {
        const next = cum + pops[perm[i]!]!;
        if (next >= target) {
          const count = Math.abs(next - target) < Math.abs(cum - target) ? i + 1 : i;
          return Math.min(m - 1, Math.max(1, count));
        }
        cum = next;
      }
      return Math.min(m - 1, Math.max(1, hi));
    }
    const a = perm[lo]!, b = perm[(lo + hi) >> 1]!, c = perm[hi - 1]!;
    const pivot = less(a, b) ? (less(b, c) ? b : less(a, c) ? c : a) : (less(a, c) ? a : less(b, c) ? c : b);
    let store = lo, wLess = 0;
    for (let i = lo; i < hi; i++) {
      const v = perm[i]!;
      if (less(v, pivot)) { perm[i] = perm[store]!; perm[store] = v; store++; wLess += pops[v]!; }
    }
    const pIdx = perm.indexOf(pivot, store);
    perm[pIdx] = perm[store]!; perm[store] = pivot;
    if (before + wLess >= target) { hi = store; continue; }
    const withPivot = before + wLess + pops[pivot]!;
    if (withPivot >= target) {
      const dEx = Math.abs(before + wLess - target), dIn = Math.abs(withPivot - target);
      const count = dIn < dEx ? store + 1 : store;
      return Math.min(m - 1, Math.max(1, count));
    }
    before = withPivot; lo = store + 1;
  }
}

export function findCut(ctx: SplitContext, members: Int32Array, seats: number, validate?: SideValidator): CutResult {
  const m = members.length;
  if (seats < 2 || m < 2) throw new DataError('a cut needs at least two seats and two blocks');
  const a = Math.floor(seats / 2), b = seats - a;
  const orientations = a === b ? [a] : [a, b];
  const ids = Int32Array.from(members);
  const pops = new Float64Array(m);
  let total = 0;
  for (let i = 0; i < m; i++) { pops[i] = ctx.blocks[members[i]!]!.pop; total += pops[i]!; }

  const segs = boundarySegments(ctx.topo, members);
  const sx = new Float64Array(segs.length * 2), sy = new Float64Array(segs.length * 2);
  segs.forEach((e, i) => {
    const pa = ctx.proj.forward(e.a), pb = ctx.proj.forward(e.b);
    sx[2 * i] = pa[0]; sy[2 * i] = pa[1]; sx[2 * i + 1] = pb[0]; sy[2 * i + 1] = pb[1];
  });

  const keys = new Float64Array(m);
  const perm = new Int32Array(m);
  const candidates: Candidate[] = [];
  for (let k = 0; k < ctx.angleCount; k++) {
    const th = (k * 180 * RAD) / ctx.angleCount;
    const nx = Math.cos(th), ny = -Math.sin(th);
    for (let i = 0; i < m; i++) keys[i] = ctx.px[members[i]!]! * nx + ctx.py[members[i]!]! * ny;
    for (const lowSeats of orientations) {
      const count = selectLow(keys, ids, pops, perm, (total * lowSeats) / seats);
      let maxLow = -Infinity, minHigh = Infinity;
      for (let i = 0; i < m; i++) {
        const kv = keys[perm[i]!]!;
        if (i < count) maxLow = Math.max(maxLow, kv); else minHigh = Math.min(minHigh, kv);
      }
      const offset = (maxLow + minHigh) / 2;
      candidates.push({ k, lowSeats, count, offset, lengthM: spanLength(ctx, sx, sy, th, offset).length });
    }
  }

  const nsDist = (k: number) => Math.min(k, ctx.angleCount - k);
  // Lengths within a centimeter count as equal: on a sphere exact ties only exist up to rounding.
  const cm = (c: Candidate) => Math.round(c.lengthM * 100);
  candidates.sort((p, q) => cm(p) - cm(q) || nsDist(p.k) - nsDist(q.k) || p.k - q.k || p.lowSeats - q.lowSeats);

  const check: SideValidator = validate ?? ((lo, hi) => isConnected(ctx.topo, lo) && isConnected(ctx.topo, hi));
  let skipped = 0;
  for (const c of candidates) {
    const th = (c.k * 180 * RAD) / ctx.angleCount;
    const nx = Math.cos(th), ny = -Math.sin(th);
    for (let i = 0; i < m; i++) keys[i] = ctx.px[members[i]!]! * nx + ctx.py[members[i]!]! * ny;
    const count = selectLow(keys, ids, pops, perm, (total * c.lowSeats) / seats);
    const low = new Int32Array(count), high = new Int32Array(m - count);
    for (let i = 0; i < m; i++) (i < count ? low : high)[i < count ? i : i - count] = members[perm[i]!]!;
    if (check(low, high)) {
      return {
        low, high, lowSeats: c.lowSeats, highSeats: seats - c.lowSeats,
        angleDeg: (c.k * 180) / ctx.angleCount, lengthM: c.lengthM,
        spans: spanLength(ctx, sx, sy, th, c.offset).spans, skipped,
      };
    }
    skipped++;
  }
  throw new DataError('no straight line produces two connected sides');
}

/** Great-circle length of the line {p . n = offset} inside the piece, by even-odd pairing of boundary crossings. */
function spanLength(ctx: SplitContext, sx: Float64Array, sy: Float64Array, th: number, offset: number) {
  const nx = Math.cos(th), ny = -Math.sin(th), dx = Math.sin(th), dy = Math.cos(th);
  const ts: number[] = [];
  for (let i = 0; i < sx.length; i += 2) {
    const s1 = sx[i]! * nx + sy[i]! * ny - offset;
    const s2 = sx[i + 1]! * nx + sy[i + 1]! * ny - offset;
    if (s1 < 0 !== s2 < 0) {
      const f = s1 / (s1 - s2);
      const x = sx[i]! + (sx[i + 1]! - sx[i]!) * f, y = sy[i]! + (sy[i + 1]! - sy[i]!) * f;
      ts.push(x * dx + y * dy);
    }
  }
  ts.sort((p, q) => p - q);
  const spans: [LonLat, LonLat][] = [];
  let length = 0;
  for (let i = 0; i + 1 < ts.length; i += 2) {
    const p = ctx.proj.inverse([offset * nx + ts[i]! * dx, offset * ny + ts[i]! * dy]);
    const q = ctx.proj.inverse([offset * nx + ts[i + 1]! * dx, offset * ny + ts[i + 1]! * dy]);
    spans.push([p, q]);
    length += greatCircleDistance(p, q);
  }
  return { length, spans };
}
