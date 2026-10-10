import { cos, sin } from '../../shared/detmath/index.js';
import { DataError } from '../../shared/errors/index.js';

/**
 * A piece of the state in local positions 0..m-1, as plain typed arrays so worker threads can share it.
 * px/py are the blocks' internal points in gnomonic coordinates on the unit sphere (dimensionless; multiply by
 * EARTH_RADIUS_M for meters near the center). lOff/lAdj/lLen the adjacency inside the piece (CSR layout) with
 * shared border lengths lLen in meters.
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

/** What a scanner needs to know about its cut. */
export interface ScanJob {
  readonly seats: number;
}

export interface Evaluation {
  /** Guide-line offset of the final population split, in projection units (unit-sphere radii, not meters). */
  offset: number;
  lengthM: number;
  /** Blocks (and their people) that changed side as strays. */
  movedBlocks: number;
  movedPop: number;
  /** Population splits made: 1 plus one per re-count. */
  iterations: number;
  /** Final offset minus the whole-block split's offset, in projection units. */
  offsetShift: number;
  /** People on the low side at the end. */
  lowPop: number;
  /** Strays remained that could not move because they were fixed; such sides are not connected. */
  unresolved: boolean;
}

const RAD = Math.PI / 180;

/**
 * Total length of the border pairs `border` (indices into a, b, len; reordered in place). The lengths are added in
 * block order, lower position a then higher position b, never in the order the pairs were found: floating-point
 * addition depends on order, so this is what makes the same border sum to the same number however a candidate
 * reached it. Each (a, b) appears once, so the order is fixed.
 */
export function borderLength(border: Int32Array, a: Int32Array, b: Int32Array, len: Float64Array): number {
  border.sort((x, y) => a[x]! - a[y]! || b[x]! - b[y]!);
  let total = 0;
  for (let i = 0; i < border.length; i++) total += len[border[i]!]!;
  return total;
}

/** Graph for the strays rule: node v is on side[v] (0 = low, 1 = high) with population, block count and lowest block index. */
export interface StrayGraph {
  readonly n: number;
  readonly off: Int32Array;
  readonly adj: Int32Array;
  readonly pop: Float64Array;
  readonly cnt: Float64Array;
  readonly minIdx: Float64Array;
  readonly side: Uint8Array;
}

/** One side's groups in one sweep of the strays rule, for observers: component of each node (-1 off the side) and the main one. */
type SweepObserver = (side: number, nodeComp: Int32Array, main: number, pop: readonly number[]) => void;

/**
 * Strays rule, in place: on the low side and then the high side, every connected component other than
 * the side's main one (most population, then most blocks, then lowest block index) joins the other side;
 * repeat until nothing moves. Pinned nodes never move and a node that moves is pinned at once, so every
 * continuing pass pins another node and the passes always end. Returns whether a pinned node was left
 * off its side's main component.
 */
export function settleStrays(g: StrayGraph, pinned: Uint8Array, observe?: SweepObserver): boolean {
  const comp = new Int32Array(g.n);
  const stack = new Int32Array(g.n);
  const cPop: number[] = [], cCnt: number[] = [], cMin: number[] = [];
  for (;;) {
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
      observe?.(s, comp, main, cPop);
      for (let v = 0; v < g.n; v++) {
        if (g.side[v] !== s || comp[v] === main) continue;
        if (pinned[v]) { stranded = true; continue; }
        g.side[v] = 1 - s; pinned[v] = 1; moved = true;
      }
    }
    if (!moved) return stranded;
  }
}

/**
 * How many blocks, taken in (key, block id) order, form the low side: the count whose cumulative population is
 * closest to `target`. A quickselect, not a sort: it writes the identity permutation into `perm` and partitions
 * only the window that still holds the target, so `perm` ends partially ordered (everything left of the final
 * window sorts before it; the rest is unspecified). Callers read the low side as the first `count` entries.
 * Those are the `count` smallest as long as minCount <= 1 and maxCount >= length - 1, which holds for every
 * caller (split uses the default clamp; resplit passes minCount 0 or 1 and maxCount f - 1 or f). Then the clamp
 * moves `count` by at most one, onto a boundary of the ordered part, so the prefix is still the `count` smallest.
 * A wider clamp (a larger minCount or a smaller maxCount) could push `count` into the unordered part and break that.
 *
 * The low side is the shortest prefix that reaches `target`, or one block fewer when that is strictly nearer
 * to it. An exact tie in distance goes to the smaller count (the strict `<` in both places). The result is
 * clamped to [minCount, maxCount], so a side is never empty by default (1 .. m - 1).
 *
 * Windows of 16 or fewer positions are insertion-sorted and scanned; larger ones are partitioned around a
 * median-of-3 pivot (first, middle, last of the window). (key, id) is a strict total order because block ids are
 * unique, so every comparison, pivot and partition depends only on the inputs and the result is deterministic.
 */
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

/** A connected group of one side's blocks in one sweep of the strays rule, in local positions; observation only. */
export interface GroupObservation {
  readonly positions: Int32Array;
  readonly pop: number;
  /** Positions in the group that were fixed when the sweep ran; they stay put even if the group is not the main body. */
  readonly fixed: Int32Array;
  /** The side's main body, the group that stays. */
  readonly main: boolean;
}

/** One sweep of the strays rule over one side that found the side in two or more groups. */
export interface SweepObservation {
  readonly side: 0 | 1;
  readonly groups: readonly GroupObservation[];
}

/** One population split and the strays settling after it, in local positions; observation only. */
export interface PassObservation {
  /** Low side's target population for this split: the share less the people held on the low side. */
  readonly target: number;
  /** Guide-line offset of this split, in projection units. */
  readonly offset: number;
  /** Side of every position after the split (0 = low), held blocks included, before strays settle. */
  readonly walk: Uint8Array;
  /** Side each position was held to during the split (-1 = free). */
  readonly held: Int8Array;
  /** Positions that changed side as strays in this pass. */
  readonly moved: Int32Array;
  /** Every sweep of the strays rule in this pass that found a side in two or more groups, in order. */
  readonly sweeps: readonly SweepObservation[];
}

export interface Scanner {
  /** Point the guide line `deg` degrees clockwise from north-south; returns the angle in radians. */
  setAngle(deg: number): number;
  /** Split for the current direction with lowSeats on the low side, apply the stray rule, and measure the border. Final sides (0 = low) go to `out` when given; `onPass` sees each split and its settling. */
  evaluate(lowSeats: number, out?: Uint8Array, onPass?: (p: PassObservation) => void): Evaluation;
  /** Local positions in the current direction's walk order: by key, then block id. */
  walkOrder(): Int32Array;
}

/** Candidate evaluation for one piece; holds scratch space, so each thread needs its own. */
export function createScanner(piece: Piece, job: ScanJob): Scanner {
  const { m, ids, pops, total, px, py, lOff, lAdj, lLen } = piece;
  const keys = new Float64Array(m);
  const perm = new Int32Array(m);
  // After selectLow the low side is every free position ordered (key, id) at or before its last member;
  // fixed blocks keep their side.
  let kL = 0, idL = 0;
  // Target of the latest split, kept for observers only.
  let lastTarget = 0;
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
  const split = (lowSeats: number): number => splitOver(keys, ids, pops, perm, (lastTarget = (total * lowSeats) / job.seats), 1, m - 1);

  // fixed[i] is the side a moved stray is held to (-1 = free); a re-count splits the free blocks again.
  const fixed = new Int8Array(m);
  const fK = new Float64Array(m), fI = new Int32Array(m), fP = new Float64Array(m), fPerm = new Int32Array(m);
  /** Population split of the free blocks, counting fixed blocks' people on their sides; returns the offset. */
  const resplit = (lowSeats: number): number => {
    let f = 0, fixedLowPop = 0, fixedLow = 0, fixedHigh = 0;
    for (let i = 0; i < m; i++) {
      const s = fixed[i]!;
      if (s < 0) { fK[f] = keys[i]!; fI[f] = ids[i]!; fP[f] = pops[i]!; f++; }
      else if (s === 0) { fixedLowPop += pops[i]!; fixedLow++; }
      else fixedHigh++;
    }
    const target = (total * lowSeats) / job.seats - fixedLowPop;
    lastTarget = target;
    // Each side keeps at least one block.
    return splitOver(fK.subarray(0, f), fI.subarray(0, f), fP.subarray(0, f), fPerm.subarray(0, f), target, fixedLow > 0 ? 0 : 1, f - (fixedHigh > 0 ? 0 : 1));
  };

  // A connected same-side piece always moves as a whole, so the strays rule runs on the graph of the
  // initial side components, linked by the cross-side adjacencies; those adjacencies are also the border.
  const side0 = new Uint8Array(m), comp = new Int32Array(m), stack = new Int32Array(m);
  let pairCap = 1024;
  let pairA = new Int32Array(pairCap), pairB = new Int32Array(pairCap), pairLen = new Float64Array(pairCap);
  let cross = new Int32Array(pairCap);
  /**
   * Strays rule and border length for the current split; final sides (0 = low) go to `out` when given.
   * Fixed blocks keep their side, form their own nodes and never move, and blocks that move become
   * fixed; `newlyFixed` counts them.
   */
  const settle = (out?: Uint8Array, sweeps?: SweepObservation[]) => {
    for (let i = 0; i < m; i++) {
      side0[i] = fixed[i]! >= 0 ? fixed[i]! : keys[i]! < kL || (keys[i] === kL && ids[i]! <= idL) ? 0 : 1;
    }
    comp.fill(-1);
    const cPop: number[] = [], cCnt: number[] = [], cMin: number[] = [], cSide: number[] = [], cPin: number[] = [];
    let np = 0;
    for (let v = 0; v < m; v++) {
      if (comp[v] !== -1) continue;
      const id = cPop.length, s = side0[v]!, pin = fixed[v]! >= 0;
      let p = 0, c = 0, mi = Infinity, top = 0;
      stack[top++] = v; comp[v] = id;
      while (top > 0) {
        const u = stack[--top]!;
        p += pops[u]!; c++;
        if (ids[u]! < mi) mi = ids[u]!;
        for (let k = lOff[u]!; k < lOff[u + 1]!; k++) {
          const j = lAdj[k]!;
          if (side0[j] === s && fixed[j]! >= 0 === pin) { if (comp[j] === -1) { comp[j] = id; stack[top++] = j; } }
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
    const pinned = Uint8Array.from(cPin);
    // Observers see each sweep's groups as positions; nodes are mapped back through comp.
    const observe: SweepObserver | undefined = sweeps && ((s, nodeComp, main, pop) => {
      const members: number[][] = pop.map(() => []), held: number[][] = pop.map(() => []);
      for (let i = 0; i < m; i++) {
        const c = nodeComp[comp[i]!]!;
        if (c < 0) continue;
        members[c]!.push(i);
        if (pinned[comp[i]!]) held[c]!.push(i);
      }
      sweeps.push({
        side: s === 0 ? 0 : 1,
        groups: pop.map((p, c) => ({ positions: Int32Array.from(members[c]!), pop: p, fixed: Int32Array.from(held[c]!), main: c === main })),
      });
    });
    const stranded = settleStrays(
      { n, off, adj, pop: Float64Array.from(cPop), cnt: Float64Array.from(cCnt), minIdx: Float64Array.from(cMin), side },
      pinned,
      observe,
    );
    // The border is the pairs that end on different sides.
    if (cross.length < np) cross = new Int32Array(pairCap);
    let nc = 0;
    for (let e = 0; e < np; e++) if (side[comp[pairA[e]!]!] !== side[comp[pairB[e]!]!]) cross[nc++] = e;
    const lengthM = borderLength(cross.subarray(0, nc), pairA, pairB, pairLen);
    let newlyFixed = 0;
    for (let i = 0; i < m; i++) if (side[comp[i]!] !== cSide[comp[i]!]) { fixed[i] = side[comp[i]!]!; newlyFixed++; }
    if (out) for (let i = 0; i < m; i++) out[i] = side[comp[i]!]!;
    return { lengthM, newlyFixed, stranded, side };
  };

  return {
    setAngle(deg: number): number {
      const th = deg * RAD;
      const nx = cos(th), ny = -sin(th);
      for (let i = 0; i < m; i++) keys[i] = px[i]! * nx + py[i]! * ny;
      return th;
    },
    walkOrder(): Int32Array {
      const order = Int32Array.from({ length: m }, (_, i) => i);
      return order.sort((a, b) => keys[a]! - keys[b]! || ids[a]! - ids[b]!);
    },
    evaluate(lowSeats: number, out?: Uint8Array, onPass?: (p: PassObservation) => void): Evaluation {
      const offset0 = split(lowSeats);
      fixed.fill(-1);
      let offset = offset0, iterations = 1;
      for (;;) {
        const held = onPass ? fixed.slice() : undefined;
        const sweeps: SweepObservation[] | undefined = onPass ? [] : undefined;
        const e = settle(out, sweeps);
        if (onPass && held) {
          const moved: number[] = [];
          for (let i = 0; i < m; i++) if (held[i]! < 0 && fixed[i]! >= 0) moved.push(i);
          onPass({ target: lastTarget, offset, walk: side0.slice(), held, moved: Int32Array.from(moved), sweeps: sweeps ?? [] });
        }
        if (e.newlyFixed === 0) {
          let movedBlocks = 0, movedPop = 0, lowPop = 0;
          for (let i = 0; i < m; i++) {
            if (fixed[i]! >= 0) { movedBlocks++; movedPop += pops[i]!; }
            if (e.side[comp[i]!] === 0) lowPop += pops[i]!;
          }
          return { offset, lengthM: e.lengthM, movedBlocks, movedPop, iterations, offsetShift: offset - offset0, lowPop, unresolved: e.stranded };
        }
        // Every re-count follows at least one newly fixed block, so this bound is never reached.
        if (++iterations > m) throw new DataError(`re-count did not settle within ${m} population splits`);
        offset = resplit(lowSeats);
      }
    },
  };
}
