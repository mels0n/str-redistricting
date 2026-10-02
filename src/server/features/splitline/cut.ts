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
  /** Great-circle length of the block-edge border between the two final sides. */
  readonly lengthM: number;
  /** The guide line's portion inside the piece. */
  readonly spans: readonly (readonly [LonLat, LonLat])[];
  /** Candidates passed over: guide lines over the stray cap, plus sides that failed validation. */
  readonly skipped: number;
  /** Guide lines rejected because their strays hold more than 1% of the piece's ideal district population (included in skipped). */
  readonly strayCapRejected: number;
  /** Blocks whose side changed when stray pieces joined the side around them, and their total population. */
  readonly strayBlocksMoved: number;
  readonly strayPopMoved: number;
}

export type SideValidator = (low: Int32Array, high: Int32Array) => boolean;

interface Candidate { k: number; lowSeats: number; offset: number; lengthM: number }

interface Evaluation { lengthM: number; movedBlocks: number; movedPop: number }

const RAD = Math.PI / 180;
const MAX_STRAY_PASSES = 10;

/** Graph for the strays rule: node v is on side[v] (0 = low, 1 = high) with population, block count and lowest block index. */
interface StrayGraph {
  readonly n: number;
  readonly off: Int32Array;
  readonly adj: Int32Array;
  readonly pop: Float64Array;
  readonly cnt: Float64Array;
  readonly minIdx: Float64Array;
  readonly side: Uint8Array;
}

/**
 * Strays rule, in place: on the low side and then the high side, every connected component other than
 * the side's main one (most population, then most blocks, then lowest block index) joins the other side;
 * repeat until nothing moves.
 */
function settleStrays(g: StrayGraph): void {
  const comp = new Int32Array(g.n);
  const stack = new Int32Array(g.n);
  const cPop: number[] = [], cCnt: number[] = [], cMin: number[] = [];
  for (let pass = 1; ; pass++) {
    let moved = false;
    for (let s = 0; s < 2; s++) {
      comp.fill(-1);
      cPop.length = 0; cCnt.length = 0; cMin.length = 0;
      for (let v = 0; v < g.n; v++) {
        if (g.side[v] !== s || comp[v] !== -1) continue;
        const id = cPop.length;
        let p = 0, c = 0, mi = Infinity, top = 0;
        stack[top++] = v; comp[v] = id;
        while (top > 0) {
          const u = stack[--top]!;
          p += g.pop[u]!; c += g.cnt[u]!;
          if (g.minIdx[u]! < mi) mi = g.minIdx[u]!;
          for (let k = g.off[u]!; k < g.off[u + 1]!; k++) {
            const w = g.adj[k]!;
            if (g.side[w] === s && comp[w] === -1) { comp[w] = id; stack[top++] = w; }
          }
        }
        cPop.push(p); cCnt.push(c); cMin.push(mi);
      }
      if (cPop.length < 2) continue;
      let main = 0;
      for (let c = 1; c < cPop.length; c++) {
        if (cPop[c]! > cPop[main]! || (cPop[c] === cPop[main] &&
          (cCnt[c]! > cCnt[main]! || (cCnt[c] === cCnt[main] && cMin[c]! < cMin[main]!)))) main = c;
      }
      for (let v = 0; v < g.n; v++) if (g.side[v] === s && comp[v] !== main) g.side[v] = 1 - s;
      moved = true;
    }
    if (!moved) return;
    if (pass >= MAX_STRAY_PASSES) throw new DataError(`stray pieces still moving after ${MAX_STRAY_PASSES} passes`);
  }
}

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
  const topo = ctx.topo;
  const ids = Int32Array.from(members);
  const pops = new Float64Array(m);
  let total = 0;
  for (let i = 0; i < m; i++) { pops[i] = ctx.blocks[members[i]!]!.pop; total += pops[i]!; }

  // Adjacency inside the piece, in local positions, with shared border lengths.
  const localOf = new Int32Array(topo.n).fill(-1);
  for (let i = 0; i < m; i++) localOf[members[i]!] = i;
  const lOff = new Int32Array(m + 1);
  for (let i = 0; i < m; i++) {
    const g = members[i]!;
    let d = 0;
    for (let k = topo.adjOffsets[g]!; k < topo.adjOffsets[g + 1]!; k++) if (localOf[topo.adjList[k]!]! >= 0) d++;
    lOff[i + 1] = lOff[i]! + d;
  }
  const lAdj = new Int32Array(lOff[m]!), lLen = new Float64Array(lOff[m]!);
  for (let i = 0, w = 0; i < m; i++) {
    const g = members[i]!;
    for (let k = topo.adjOffsets[g]!; k < topo.adjOffsets[g + 1]!; k++) {
      const j = localOf[topo.adjList[k]!]!;
      if (j >= 0) { lAdj[w] = j; lLen[w] = topo.adjLength[k]!; w++; }
    }
  }

  const segs = boundarySegments(topo, members);
  const sx = new Float64Array(segs.count * 2), sy = new Float64Array(segs.count * 2);
  for (let i = 0; i < segs.count; i++) {
    const pa = ctx.proj.forward([segs.a[2 * i]!, segs.a[2 * i + 1]!]);
    const pb = ctx.proj.forward([segs.b[2 * i]!, segs.b[2 * i + 1]!]);
    sx[2 * i] = pa[0]; sy[2 * i] = pa[1]; sx[2 * i + 1] = pb[0]; sy[2 * i + 1] = pb[1];
  }

  const keys = new Float64Array(m);
  const perm = new Int32Array(m);
  const setKeys = (k: number): number => {
    const th = (k * 180 * RAD) / ctx.angleCount;
    const nx = Math.cos(th), ny = -Math.sin(th);
    for (let i = 0; i < m; i++) keys[i] = ctx.px[members[i]!]! * nx + ctx.py[members[i]!]! * ny;
    return th;
  };
  // After selectLow the low side is every position ordered (key, id) at or before its last member.
  let kL = 0, idL = 0;
  /** Whole-block split of the current keys: records the low side's last member and returns the guide-line offset. */
  const split = (lowSeats: number): number => {
    const count = selectLow(keys, ids, pops, perm, (total * lowSeats) / seats);
    let maxLow = -Infinity, minHigh = Infinity, last = -1;
    for (let i = 0; i < m; i++) {
      const p = perm[i]!, kv = keys[p]!;
      if (i < count) {
        if (last < 0 || kv > keys[last]! || (kv === keys[last] && ids[p]! > ids[last]!)) last = p;
        maxLow = Math.max(maxLow, kv);
      } else minHigh = Math.min(minHigh, kv);
    }
    kL = keys[last]!; idL = ids[last]!;
    return (maxLow + minHigh) / 2;
  };

  // A connected same-side piece always moves as a whole, so the strays rule runs on the graph of the
  // initial side components, linked by the cross-side adjacencies; those adjacencies are also the border.
  const side0 = new Uint8Array(m), comp = new Int32Array(m), stack = new Int32Array(m);
  let pairCap = 1024;
  let pairA = new Int32Array(pairCap), pairB = new Int32Array(pairCap), pairLen = new Float64Array(pairCap);
  /** Strays rule and border length for the current split; final sides (0 = low) go to `out` when given. */
  const evaluate = (out?: Uint8Array): Evaluation => {
    for (let i = 0; i < m; i++) side0[i] = keys[i]! < kL || (keys[i] === kL && ids[i]! <= idL) ? 0 : 1;
    comp.fill(-1);
    const cPop: number[] = [], cCnt: number[] = [], cMin: number[] = [], cSide: number[] = [];
    let np = 0;
    for (let v = 0; v < m; v++) {
      if (comp[v] !== -1) continue;
      const id = cPop.length, s = side0[v]!;
      let p = 0, c = 0, mi = Infinity, top = 0;
      stack[top++] = v; comp[v] = id;
      while (top > 0) {
        const u = stack[--top]!;
        p += pops[u]!; c++;
        if (ids[u]! < mi) mi = ids[u]!;
        for (let k = lOff[u]!; k < lOff[u + 1]!; k++) {
          const j = lAdj[k]!;
          if (side0[j] === s) { if (comp[j] === -1) { comp[j] = id; stack[top++] = j; } }
          else if (u < j) {
            if (np === pairCap) {
              pairCap *= 2;
              const na = new Int32Array(pairCap), nb = new Int32Array(pairCap), nl = new Float64Array(pairCap);
              na.set(pairA); nb.set(pairB); nl.set(pairLen);
              pairA = na; pairB = nb; pairLen = nl;
            }
            pairA[np] = u; pairB[np] = j; pairLen[np] = lLen[k]!; np++;
          }
        }
      }
      cPop.push(p); cCnt.push(c); cMin.push(mi); cSide.push(s);
    }
    const n = cPop.length;
    const off = new Int32Array(n + 1);
    for (let e = 0; e < np; e++) { off[comp[pairA[e]!]! + 1]!++; off[comp[pairB[e]!]! + 1]!++; }
    for (let v = 0; v < n; v++) off[v + 1] = off[v + 1]! + off[v]!;
    const adj = new Int32Array(off[n]!), cur = off.slice(0, n);
    for (let e = 0; e < np; e++) {
      const x = comp[pairA[e]!]!, y = comp[pairB[e]!]!;
      adj[cur[x]!++] = y; adj[cur[y]!++] = x;
    }
    const side = Uint8Array.from(cSide);
    settleStrays({ n, off, adj, pop: Float64Array.from(cPop), cnt: Float64Array.from(cCnt), minIdx: Float64Array.from(cMin), side });
    let lengthM = 0, movedBlocks = 0, movedPop = 0;
    for (let e = 0; e < np; e++) if (side[comp[pairA[e]!]!] !== side[comp[pairB[e]!]!]) lengthM += pairLen[e]!;
    for (let v = 0; v < n; v++) if (side[v] !== cSide[v]) { movedBlocks += cCnt[v]!; movedPop += cPop[v]!; }
    if (out) for (let i = 0; i < m; i++) out[i] = side[comp[i]!]!;
    return { lengthM, movedBlocks, movedPop };
  };

  const candidates: Candidate[] = [];
  let strayCapRejected = 0;
  for (let k = 0; k < ctx.angleCount; k++) {
    setKeys(k);
    for (const lowSeats of orientations) {
      const offset = split(lowSeats);
      const e = evaluate();
      // Stray cap: strays may hold at most 1% of the piece's ideal district population (pop / seats).
      // Populations are integers, so this form of the comparison is exact.
      if (e.movedPop * 100 * seats > total) { strayCapRejected++; continue; }
      candidates.push({ k, lowSeats, offset, lengthM: e.lengthM });
    }
  }

  const nsDist = (k: number) => Math.min(k, ctx.angleCount - k);
  // Lengths within a centimeter count as equal: on a sphere exact ties only exist up to rounding.
  const cm = (c: Candidate) => Math.round(c.lengthM * 100);
  candidates.sort((p, q) => cm(p) - cm(q) || nsDist(p.k) - nsDist(q.k) || p.k - q.k || p.lowSeats - q.lowSeats);

  const check: SideValidator = validate ?? ((lo, hi) => isConnected(topo, lo) && isConnected(topo, hi));
  const side = new Uint8Array(m);
  let skipped = strayCapRejected;
  for (const c of candidates) {
    const th = setKeys(c.k);
    split(c.lowSeats);
    const e = evaluate(side);
    let nLow = 0;
    for (let i = 0; i < m; i++) if (side[i] === 0) nLow++;
    const low = new Int32Array(nLow), high = new Int32Array(m - nLow);
    for (let i = 0, l = 0, h = 0; i < m; i++) { if (side[i] === 0) low[l++] = members[i]!; else high[h++] = members[i]!; }
    if (check(low, high)) {
      return {
        low, high, lowSeats: c.lowSeats, highSeats: seats - c.lowSeats,
        angleDeg: (c.k * 180) / ctx.angleCount, lengthM: e.lengthM,
        spans: spanLength(ctx, sx, sy, th, c.offset).spans, skipped, strayCapRejected,
        strayBlocksMoved: e.movedBlocks, strayPopMoved: e.movedPop,
      };
    }
    skipped++;
  }
  throw new DataError('no straight line meets the stray cap and produces two connected sides');
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
