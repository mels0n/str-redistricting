import { cos, sin } from '../../shared/detmath/index.js';
import { DataError } from '../../shared/errors/index.js';

/**
 * A piece of the state in local positions 0..m-1, as plain typed arrays so worker threads can share it.
 * px/py are the projected internal points; lOff/lAdj/lLen the adjacency inside the piece with shared
 * border lengths in meters.
 */
export interface Piece {
  readonly m: number;
  readonly ids: Int32Array;
  readonly pops: Float64Array;
  readonly total: number;
  readonly px: Float64Array;
  readonly py: Float64Array;
  readonly lOff: Int32Array;
  readonly lAdj: Int32Array;
  readonly lLen: Float64Array;
}

/**
 * What to do with strays. `cap`: they join the side around them and a guide line whose strays hold more
 * than 1% of an ideal district is not used. `recount`: they join the side around them and stay there
 * (fixed), the population split is redone over the other blocks, and this repeats until no strays are
 * left; there is no cap.
 */
export type StrayRule = 'cap' | 'recount';

/** What to evaluate for one cut: every direction k < angleCount, once per low-side seat count. */
export interface ScanJob {
  readonly angleCount: number;
  readonly seats: number;
  readonly orientations: readonly number[];
  readonly rule: StrayRule;
}

/** Per-candidate fields in a scan result buffer; candidate (k, o) starts at (k * orientations + o) * FIELDS. */
export const FIELDS = 8;
export const F_OFFSET = 0, F_LENGTH = 1, F_BLOCKS = 2, F_POP = 3, F_ITER = 4, F_SHIFT = 5, F_LOWPOP = 6, F_UNRESOLVED = 7;

export interface Evaluation {
  /** Guide-line offset of the final population split, in projection units. */
  offset: number;
  lengthM: number;
  /** Blocks (and their people) that changed side as strays. */
  movedBlocks: number;
  movedPop: number;
  /** Population splits made: 1 plus one per recount. */
  iterations: number;
  /** Final offset minus the whole-block split's offset, in projection units. */
  offsetShift: number;
  /** People on the low side at the end. */
  lowPop: number;
  /** Strays remained that could not move because they were fixed (recount only); such sides are not connected. */
  unresolved: boolean;
}

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
 * repeat until nothing moves. With `pinned`, pinned nodes never move and a node that moves is pinned at
 * once, so the passes always end; returns whether a pinned node was left off its side's main component.
 */
function settleStrays(g: StrayGraph, pinned?: Uint8Array): boolean {
  const comp = new Int32Array(g.n);
  const stack = new Int32Array(g.n);
  const cPop: number[] = [], cCnt: number[] = [], cMin: number[] = [];
  for (let pass = 1; ; pass++) {
    let moved = false, stranded = false;
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
      if (!pinned) {
        for (let v = 0; v < g.n; v++) if (g.side[v] === s && comp[v] !== main) g.side[v] = 1 - s;
        moved = true;
        continue;
      }
      for (let v = 0; v < g.n; v++) {
        if (g.side[v] !== s || comp[v] === main) continue;
        if (pinned[v]) { stranded = true; continue; }
        g.side[v] = 1 - s; pinned[v] = 1; moved = true;
      }
    }
    if (!moved) return stranded;
    if (!pinned && pass >= MAX_STRAY_PASSES) throw new DataError(`stray pieces still moving after ${MAX_STRAY_PASSES} passes`);
  }
}

/** Order local positions by (key, block id) and return the low-side count closest to the target population. */
export function selectLow(keys: Float64Array, ids: Int32Array, pops: Float64Array, perm: Int32Array, target: number, minCount = 1, maxCount = perm.length - 1): number {
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
          return Math.min(maxCount, Math.max(minCount, count));
        }
        cum = next;
      }
      return Math.min(maxCount, Math.max(minCount, hi));
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
      return Math.min(maxCount, Math.max(minCount, count));
    }
    before = withPivot; lo = store + 1;
  }
}

export interface Scanner {
  /** Point the guide line in direction k (k * 180 / angleCount degrees from north-south); returns the angle in radians. */
  setDirection(k: number): number;
  /** Split for the current direction with lowSeats on the low side, apply the stray rule, and measure the border. Final sides (0 = low) go to `out` when given. */
  evaluate(lowSeats: number, out?: Uint8Array): Evaluation;
}

/** Candidate evaluation for one piece; holds scratch space, so each thread needs its own. */
export function createScanner(piece: Piece, job: ScanJob): Scanner {
  const { m, ids, pops, total, px, py, lOff, lAdj, lLen } = piece;
  const keys = new Float64Array(m);
  const perm = new Int32Array(m);
  // After selectLow the low side is every position ordered (key, id) at or before its last member
  // (among the blocks that were split; fixed blocks keep their side).
  let kL = 0, idL = 0;
  /**
   * Population split of the given blocks in (key, id) order: records the low side's last member and
   * returns the guide-line offset, halfway between the last low key and the first high key.
   */
  const splitOver = (K: Float64Array, I: Int32Array, Pp: Float64Array, Pm: Int32Array, target: number, minCount: number, maxCount: number): number => {
    const n = Pm.length;
    const count = selectLow(K, I, Pp, Pm, target, minCount, maxCount);
    let maxLow = -Infinity, minHigh = Infinity, last = -1;
    for (let i = 0; i < n; i++) {
      const p = Pm[i]!, kv = K[p]!;
      if (i < count) {
        if (last < 0 || kv > K[last]! || (kv === K[last] && I[p]! > I[last]!)) last = p;
        maxLow = Math.max(maxLow, kv);
      } else minHigh = Math.min(minHigh, kv);
    }
    if (last < 0) { kL = -Infinity; idL = -1; return minHigh; }
    kL = K[last]!; idL = I[last]!;
    return count === n ? maxLow : (maxLow + minHigh) / 2;
  };
  /** Whole-block split of the current keys. */
  const split = (lowSeats: number): number => splitOver(keys, ids, pops, perm, (total * lowSeats) / job.seats, 1, m - 1);

  // Recount: fixed[i] is the side a moved stray is held to (-1 = free); the free blocks are re-split.
  const fixed = job.rule === 'recount' ? new Int8Array(m) : undefined;
  const fK = fixed ? new Float64Array(m) : keys, fI = fixed ? new Int32Array(m) : ids;
  const fP = fixed ? new Float64Array(m) : pops, fPerm = fixed ? new Int32Array(m) : perm;
  /** Population split of the free blocks, counting fixed blocks' people on their sides; returns the offset. */
  const resplit = (lowSeats: number): number => {
    let f = 0, fixedLowPop = 0, fixedLow = 0, fixedHigh = 0;
    for (let i = 0; i < m; i++) {
      const s = fixed![i]!;
      if (s < 0) { fK[f] = keys[i]!; fI[f] = ids[i]!; fP[f] = pops[i]!; f++; }
      else if (s === 0) { fixedLowPop += pops[i]!; fixedLow++; }
      else fixedHigh++;
    }
    const target = (total * lowSeats) / job.seats - fixedLowPop;
    // Each side keeps at least one block.
    return splitOver(fK.subarray(0, f), fI.subarray(0, f), fP.subarray(0, f), fPerm.subarray(0, f), target, fixedLow > 0 ? 0 : 1, f - (fixedHigh > 0 ? 0 : 1));
  };

  // A connected same-side piece always moves as a whole, so the strays rule runs on the graph of the
  // initial side components, linked by the cross-side adjacencies; those adjacencies are also the border.
  const side0 = new Uint8Array(m), comp = new Int32Array(m), stack = new Int32Array(m);
  let pairCap = 1024;
  let pairA = new Int32Array(pairCap), pairB = new Int32Array(pairCap), pairLen = new Float64Array(pairCap);
  /**
   * Strays rule and border length for the current split; final sides (0 = low) go to `out` when given.
   * Under recount, fixed blocks keep their side, form their own nodes and never move, and blocks that
   * move become fixed; `newlyFixed` counts them.
   */
  const settle = (out?: Uint8Array) => {
    for (let i = 0; i < m; i++) {
      side0[i] = fixed && fixed[i]! >= 0 ? fixed[i]! : keys[i]! < kL || (keys[i] === kL && ids[i]! <= idL) ? 0 : 1;
    }
    comp.fill(-1);
    const cPop: number[] = [], cCnt: number[] = [], cMin: number[] = [], cSide: number[] = [], cPin: number[] = [];
    let np = 0;
    for (let v = 0; v < m; v++) {
      if (comp[v] !== -1) continue;
      const id = cPop.length, s = side0[v]!, pin = fixed !== undefined && fixed[v]! >= 0;
      let p = 0, c = 0, mi = Infinity, top = 0;
      stack[top++] = v; comp[v] = id;
      while (top > 0) {
        const u = stack[--top]!;
        p += pops[u]!; c++;
        if (ids[u]! < mi) mi = ids[u]!;
        for (let k = lOff[u]!; k < lOff[u + 1]!; k++) {
          const j = lAdj[k]!;
          if (side0[j] === s && (fixed === undefined || fixed[j]! >= 0 === pin)) { if (comp[j] === -1) { comp[j] = id; stack[top++] = j; } }
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
      cPop.push(p); cCnt.push(c); cMin.push(mi); cSide.push(s); cPin.push(pin ? 1 : 0);
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
    const stranded = settleStrays(
      { n, off, adj, pop: Float64Array.from(cPop), cnt: Float64Array.from(cCnt), minIdx: Float64Array.from(cMin), side },
      fixed ? Uint8Array.from(cPin) : undefined,
    );
    let lengthM = 0, movedBlocks = 0, movedPop = 0, newlyFixed = 0;
    for (let e = 0; e < np; e++) if (side[comp[pairA[e]!]!] !== side[comp[pairB[e]!]!]) lengthM += pairLen[e]!;
    for (let v = 0; v < n; v++) if (side[v] !== cSide[v]) { movedBlocks += cCnt[v]!; movedPop += cPop[v]!; }
    if (fixed) for (let i = 0; i < m; i++) if (side[comp[i]!] !== cSide[comp[i]!]) { fixed[i] = side[comp[i]!]!; newlyFixed++; }
    if (out) for (let i = 0; i < m; i++) out[i] = side[comp[i]!]!;
    return { lengthM, movedBlocks, movedPop, newlyFixed, stranded, side };
  };

  return {
    setDirection(k: number): number {
      const th = (k * 180 * RAD) / job.angleCount;
      const nx = cos(th), ny = -sin(th);
      for (let i = 0; i < m; i++) keys[i] = px[i]! * nx + py[i]! * ny;
      return th;
    },
    evaluate(lowSeats: number, out?: Uint8Array): Evaluation {
      const offset0 = split(lowSeats);
      if (!fixed) {
        const e = settle(out);
        let lowPop = 0;
        for (let i = 0; i < m; i++) if (e.side[comp[i]!] === 0) lowPop += pops[i]!;
        return { offset: offset0, lengthM: e.lengthM, movedBlocks: e.movedBlocks, movedPop: e.movedPop, iterations: 1, offsetShift: 0, lowPop, unresolved: false };
      }
      fixed.fill(-1);
      let offset = offset0, iterations = 1;
      for (;;) {
        const e = settle(out);
        if (e.newlyFixed === 0) {
          let movedBlocks = 0, movedPop = 0, lowPop = 0;
          for (let i = 0; i < m; i++) {
            if (fixed[i]! >= 0) { movedBlocks++; movedPop += pops[i]!; }
            if (e.side[comp[i]!] === 0) lowPop += pops[i]!;
          }
          return { offset, lengthM: e.lengthM, movedBlocks, movedPop, iterations, offsetShift: offset - offset0, lowPop, unresolved: e.stranded };
        }
        // Every recount follows at least one newly fixed block, so this bound is never reached.
        if (++iterations > m) throw new DataError(`recount did not settle within ${m} population splits`);
        offset = resplit(lowSeats);
      }
    },
  };
}

/** Evaluate directions from `next()` until it passes the last one, writing each candidate's fields into `res`. */
export function scanDirections(piece: Piece, job: ScanJob, res: Float64Array, next: () => number): void {
  const scanner = createScanner(piece, job);
  const no = job.orientations.length;
  for (let k = next(); k < job.angleCount; k = next()) {
    scanner.setDirection(k);
    for (let o = 0; o < no; o++) {
      const e = scanner.evaluate(job.orientations[o]!);
      const at = (k * no + o) * FIELDS;
      res[at + F_OFFSET] = e.offset; res[at + F_LENGTH] = e.lengthM;
      res[at + F_BLOCKS] = e.movedBlocks; res[at + F_POP] = e.movedPop;
      res[at + F_ITER] = e.iterations; res[at + F_SHIFT] = e.offsetShift;
      res[at + F_LOWPOP] = e.lowPop; res[at + F_UNRESOLVED] = e.unresolved ? 1 : 0;
    }
  }
}
