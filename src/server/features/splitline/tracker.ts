/**
 * A direction is a vector between two points, written as an index pair (i, j) meaning P[j] - P[i]. Indices >= 0
 * are blocks; -1 is the origin; the sweep's start direction is (-4, -2) and its end direction (-5, -3). Every
 * direction is normalised to the half plane x > 0 (or x = 0, y > 0); north (0, 1) is the start of the half turn and
 * directions turn clockwise. The line's normal is n = (uy, -ux), so a block's key is p . n; the angle from north is
 * atan2(ux, uy).
 *
 * Two blocks a, b swap order at direction b - a. The order "just after" direction u: sign of cross(b - a, u), and
 * at an exact zero, sign of -dot(b - a, u) (the order the turn is about to produce); identical points by block id.
 */
import { signOfDifference as det } from '../../shared/exact/index.js';

export interface Geo {
  readonly px: Float64Array;
  readonly py: Float64Array;
  readonly ids: Int32Array;
  readonly pops: Float64Array;
  /** Start direction = (s2 - s1), end direction = (e2 - e1); the end is ignored for scheduling when endIsPi. */
  s1x: number; s1y: number; sx: number; sy: number; e1x: number; e1y: number; ex: number; ey: number; endIsPi: boolean;
}

export const X = (g: Geo, i: number) => (i >= 0 ? g.px[i]! : i === -1 ? 0 : i === -2 ? g.sx : i === -3 ? g.ex : i === -4 ? g.s1x : g.e1x);
export const Y = (g: Geo, i: number) => (i >= 0 ? g.py[i]! : i === -1 ? 0 : i === -2 ? g.sy : i === -3 ? g.ey : i === -4 ? g.s1y : g.e1y);

/** Normalising sign of the vector P[j] - P[i] (0 when the points coincide). Float subtraction keeps the exact sign. */
export function nsign(g: Geo, i: number, j: number): number {
  const dx = X(g, j) - X(g, i);
  if (dx > 0) return 1;
  if (dx < 0) return -1;
  const dy = Y(g, j) - Y(g, i);
  return dy > 0 ? 1 : dy < 0 ? -1 : 0;
}

/** Sign of cross(v1, v2) for the normalised directions; negative when v1 comes first in the turn. */
export function crossDir(g: Geo, i1: number, j1: number, i2: number, j2: number): number {
  if ((i1 === i2 && j1 === j2) || (i1 === j2 && j1 === i2)) return 0;
  const s = nsign(g, i1, j1) * nsign(g, i2, j2);
  return s * det(X(g, j1), X(g, i1), Y(g, j2), Y(g, i2), Y(g, j1), Y(g, i1), X(g, j2), X(g, i2));
}

/** >0 when block x comes before block y just after direction (ci, cj). */
export function orderAfter(g: Geo, x: number, y: number, ci: number, cj: number): number {
  const su = nsign(g, ci, cj);
  const samePair = (x === ci && y === cj) || (x === cj && y === ci);
  // cross(d, u), d = P[y] - P[x], u = P[cj] - P[ci]: (dx)(uy) - (dy)(ux)
  const c = samePair ? 0 : su * det(X(g, y), X(g, x), Y(g, cj), Y(g, ci), Y(g, y), Y(g, x), X(g, cj), X(g, ci));
  if (c !== 0) return c;
  // dot(d, u) = dx ux + dy uy = (dx)(ux) - (dy)(-uy)
  const d = su * det(X(g, y), X(g, x), X(g, cj), X(g, ci), Y(g, y), Y(g, x), Y(g, ci), Y(g, cj));
  if (d !== 0) return -d;
  return g.ids[x]! < g.ids[y]! ? 1 : -1;
}

export class Tracker {
  curI: number; curJ: number;
  readonly inA: Uint8Array; // 1 low, 0 high, 2 not in this tracker
  W = 0; nA = 0; nB = 0;
  private readonly hA: Int32Array; private readonly hB: Int32Array;
  private readonly pos: Int32Array; private readonly ver: Int32Array;
  private qI: Int32Array; private qJ: Int32Array; private qS: Int32Array; private qV: Int32Array;
  private qn = 0;
  private toggles: number[] = [];
  private readonly tog: Uint8Array;
  private needValidate = false;
  private initPhase = true;
  events = 0;
  readonly m: number;

  constructor(
    private readonly g: Geo, m: number, free: Int32Array,
    private T: number, private minC: number, private maxC: number,
    curI: number, curJ: number,
    initialCount: (free: Int32Array, ux: number, uy: number) => number,
  ) {
    this.m = m; this.curI = curI; this.curJ = curJ;
    this.inA = new Uint8Array(m).fill(2);
    this.pos = new Int32Array(m).fill(-1);
    this.ver = new Int32Array(m + 1);
    this.tog = new Uint8Array(m);
    const n = free.length;
    this.hA = new Int32Array(n); this.hB = new Int32Array(n);
    const cap = 2 * (n + 1) + 64;
    this.qI = new Int32Array(cap); this.qJ = new Int32Array(cap); this.qS = new Int32Array(cap); this.qV = new Int32Array(cap);
    const su = nsign(g, curI, curJ);
    const count = initialCount(free, su * (X(g, curJ) - X(g, curI)), su * (Y(g, curJ) - Y(g, curI)));
    for (let i = 0; i < n; i++) {
      const x = free[i]!;
      if (i < count) { this.hA[this.nA] = x; this.pos[x] = this.nA++; this.inA[x] = 1; this.W += g.pops[x]!; }
      else { this.hB[this.nB] = x; this.pos[x] = this.nB++; this.inA[x] = 0; }
    }
    this.heapify(true); this.heapify(false);
    // Certificates in bulk, then one heapify of the queue (refresh would push one at a time).
    for (let i = 1; i < this.nA; i++) this.refresh(true, i);
    for (let i = 1; i < this.nB; i++) this.refresh(false, i);
    this.refreshCross();
    for (let i = (this.qn >> 1) - 1; i >= 0; i--) this.qDown(i);
    this.initPhase = false;
    this.validate();
    // Settle any order the float start got wrong (immediate events at the current direction).
    while (this.hasNow()) this.processGroup();
    this.clearToggles();
  }

  private before(x: number, y: number): boolean { return orderAfter(this.g, x, y, this.curI, this.curJ) > 0; }
  /** Event direction of pair (x, y) if it lies strictly after the current direction and strictly before the end. */
  private scheduleFor(x: number, y: number, slot: number, v: number) {
    const i = Math.min(x, y), j = Math.max(x, y);
    if (nsign(this.g, i, j) === 0) return;
    if (crossDir(this.g, this.curI, this.curJ, i, j) >= 0) return;
    if (!this.g.endIsPi && crossDir(this.g, i, j, -5, -3) >= 0) return;
    this.push(i, j, slot, v);
  }

  // ---- heaps ----
  private H(a: boolean) { return a ? this.hA : this.hB; }
  private size(a: boolean) { return a ? this.nA : this.nB; }
  private ok(a: boolean, c: number, q: number): boolean { return a ? this.before(c, q) : this.before(q, c); }
  private heapify(a: boolean) { for (let i = (this.size(a) >> 1) - 1; i >= 0; i--) this.siftDown(a, i, null); }
  private swap(a: boolean, i: number, j: number) {
    const H = this.H(a); const x = H[i]!, y = H[j]!;
    H[i] = y; H[j] = x; this.pos[y] = i; this.pos[x] = j;
  }
  private siftDown(a: boolean, i: number, touched: number[] | null) {
    const H = this.H(a), n = this.size(a);
    for (;;) {
      touched?.push(i);
      const l = 2 * i + 1, r = l + 1;
      let best = i;
      if (l < n && !this.ok(a, H[l]!, H[best]!)) best = l;
      if (r < n && !this.ok(a, H[r]!, H[best]!)) best = r;
      if (best === i) return;
      this.swap(a, i, best); i = best;
    }
  }
  private siftUp(a: boolean, i: number, touched: number[]) {
    const H = this.H(a);
    touched.push(i);
    while (i > 0) {
      const q = (i - 1) >> 1;
      if (this.ok(a, H[i]!, H[q]!)) return;
      this.swap(a, i, q); i = q; touched.push(i);
    }
  }
  private refreshTouched(a: boolean, touched: number[]) {
    const n = this.size(a);
    let root = false;
    for (const i of touched) {
      if (i >= n) continue;
      if (i === 0) root = true;
      this.refresh(a, i);
      const l = 2 * i + 1;
      if (l < n) this.refresh(a, l);
      if (l + 1 < n) this.refresh(a, l + 1);
    }
    if (root) { this.refreshCross(); this.needValidate = true; }
  }
  private insert(a: boolean, x: number) {
    const H = this.H(a);
    const i = a ? this.nA++ : this.nB++;
    H[i] = x; this.pos[x] = i; this.inA[x] = a ? 1 : 0;
    const touched: number[] = [];
    this.siftUp(a, i, touched);
    this.refreshTouched(a, touched);
  }
  private popRoot(a: boolean): number {
    const H = this.H(a);
    const x = H[0]!;
    const n = a ? --this.nA : --this.nB;
    this.ver[x]!++;
    this.pos[x] = -1;
    if (n > 0) {
      const last = H[n]!; H[0] = last; this.pos[last] = 0;
      const touched: number[] = [];
      this.siftDown(a, 0, touched);
      this.refreshTouched(a, touched);
    }
    this.refreshCross(); this.needValidate = true;
    return x;
  }

  /** Remove block x from whichever heap holds it (it leaves this tracker). */
  private removeAny(x: number) {
    const a = this.inA[x] === 1;
    const H = this.H(a);
    const i = this.pos[x]!;
    const n = a ? --this.nA : --this.nB;
    this.ver[x]!++;
    this.pos[x] = -1; this.inA[x] = 2;
    if (a) this.W -= this.g.pops[x]!;
    if (i < n) {
      const last = H[n]!; H[i] = last; this.pos[last] = i;
      const touched: number[] = [];
      this.siftUp(a, i, touched);
      this.siftDown(a, this.pos[last]!, touched);
      this.refreshTouched(a, touched);
    }
    if (i === 0 || n === 0) { this.refreshCross(); this.needValidate = true; }
  }
  /** Add block x on the side that keeps the low set a prefix. */
  private addAny(x: number) {
    const a = this.nA > 0 && this.before(x, this.hA[0]!);
    if (a) this.W += this.g.pops[x]!;
    this.insert(a, x);
  }
  /**
   * Same direction, new free set and target: drop blocks that became fixed, add blocks that became free, then
   * re-apply the stopping rule. Costs O(changed blocks x log n) instead of a rebuild.
   */
  reconfigure(fixed: Int8Array, T: number, minC: number, maxC: number, ci: number, cj: number) {
    // Every event up to (ci, cj) has been processed (the sweep moves all trackers in step), so the state is valid there.
    this.curI = ci; this.curJ = cj;
    for (let i = 0; i < this.m; i++) {
      const inThis = this.inA[i] !== 2, free = fixed[i]! < 0;
      if (inThis && !free) this.removeAny(i);
      else if (!inThis && free) this.addAny(i);
    }
    this.T = T; this.minC = minC; this.maxC = maxC;
    this.refreshCross();
    this.validate();
    while (this.hasNow()) this.processGroup();
    this.clearToggles();
  }

  /**
   * Same as reconfigure, but only for the listed blocks: each becomes free (joins this tracker) or fixed (leaves it).
   * O(changed blocks x log n).
   */
  applyDelta(blocks: readonly number[], nowFree: readonly boolean[], T: number, minC: number, maxC: number, ci: number, cj: number) {
    this.curI = ci; this.curJ = cj;
    for (let k = 0; k < blocks.length; k++) {
      const x = blocks[k]!, inThis = this.inA[x] !== 2;
      if (inThis && !nowFree[k]) this.removeAny(x);
      else if (!inThis && nowFree[k]) this.addAny(x);
    }
    this.T = T; this.minC = minC; this.maxC = maxC;
    this.refreshCross();
    this.validate();
    while (this.hasNow()) this.processGroup();
  }

  // ---- certificates / queue ----
  private refresh(a: boolean, i: number) {
    const H = this.H(a);
    const x = H[i]!;
    const v = ++this.ver[x]!;
    if (i === 0) return;
    const q = H[(i - 1) >> 1]!;
    if (this.ok(a, x, q)) this.scheduleFor(x, q, x, v);
    else this.push(this.curI, this.curJ, x, v);
  }
  private refreshCross() {
    const s = this.m;
    const v = ++this.ver[s]!;
    if (this.nA === 0 || this.nB === 0) return;
    const a = this.hA[0]!, b = this.hB[0]!;
    if (this.before(a, b)) this.scheduleFor(a, b, s, v);
    else this.push(this.curI, this.curJ, s, v);
  }
  private qLess(a: number, b: number): boolean {
    return crossDir(this.g, this.qI[a]!, this.qJ[a]!, this.qI[b]!, this.qJ[b]!) < 0;
  }
  private push(i: number, j: number, s: number, v: number) {
    if (this.qn === this.qI.length) this.compactOrGrow();
    const k = this.qn++;
    this.qI[k] = i; this.qJ[k] = j; this.qS[k] = s; this.qV[k] = v;
    if (!this.initPhase) this.qUp(k);
  }
  private qSwap(a: number, b: number) {
    const { qI, qJ, qS, qV } = this;
    let t = qI[a]!; qI[a] = qI[b]!; qI[b] = t;
    t = qJ[a]!; qJ[a] = qJ[b]!; qJ[b] = t;
    t = qS[a]!; qS[a] = qS[b]!; qS[b] = t;
    t = qV[a]!; qV[a] = qV[b]!; qV[b] = t;
  }
  private qUp(k: number) {
    while (k > 0) { const p = (k - 1) >> 1; if (!this.qLess(k, p)) break; this.qSwap(k, p); k = p; }
  }
  private qDown(k: number) {
    const n = this.qn;
    for (;;) {
      const l = 2 * k + 1;
      if (l >= n) return;
      let c = l;
      if (l + 1 < n && this.qLess(l + 1, l)) c = l + 1;
      if (!this.qLess(c, k)) return;
      this.qSwap(c, k); k = c;
    }
  }
  private compactOrGrow() {
    let w = 0;
    for (let i = 0; i < this.qn; i++) {
      if (this.qV[i] === this.ver[this.qS[i]!]) { this.qI[w] = this.qI[i]!; this.qJ[w] = this.qJ[i]!; this.qS[w] = this.qS[i]!; this.qV[w] = this.qV[i]!; w++; }
    }
    this.qn = w;
    if (w > this.qI.length / 2) {
      const cap = this.qI.length * 2;
      const grow = (a: Int32Array) => { const b = new Int32Array(cap); b.set(a.subarray(0, w)); return b; };
      this.qI = grow(this.qI); this.qJ = grow(this.qJ); this.qS = grow(this.qS); this.qV = grow(this.qV);
    }
    if (!this.initPhase) for (let i = (w >> 1) - 1; i >= 0; i--) this.qDown(i);
  }
  private qPop() {
    const n = --this.qn;
    if (n > 0) {
      this.qI[0] = this.qI[n]!; this.qJ[0] = this.qJ[n]!; this.qS[0] = this.qS[n]!; this.qV[0] = this.qV[n]!;
      this.qDown(0);
    }
  }
  /** Drop stale entries; true when a live event remains. */
  hasNext(): boolean {
    while (this.qn > 0 && this.qV[0] !== this.ver[this.qS[0]!]) this.qPop();
    return this.qn > 0;
  }
  /** Direction of the next live event (call hasNext first). */
  nextI(): number { return this.qI[0]!; }
  nextJ(): number { return this.qJ[0]!; }
  private hasNow(): boolean {
    return this.hasNext() && crossDir(this.g, this.qI[0]!, this.qJ[0]!, this.curI, this.curJ) === 0;
  }

  private toggle(x: number) { if ((this.tog[x]! ^= 1)) this.toggles.push(x); }
  clearToggles() { for (const x of this.toggles) this.tog[x] = 0; this.toggles.length = 0; }
  netMoved(): number[] { return this.toggles.filter((x) => this.tog[x] === 1); }

  private validate() {
    const { pops } = this.g, T = this.T;
    for (;;) {
      const c = this.nA, W = this.W;
      if (c > 0 && c > this.minC) {
        const a = this.hA[0]!, pa = pops[a]!;
        if (W - pa >= T || (W >= T && !(Math.abs(W - T) < Math.abs(W - pa - T)))) {
          const x = this.popRoot(true); this.W -= pops[x]!; this.insert(false, x); this.toggle(x); continue;
        }
      }
      if (c > 0 && W >= T) break;
      if (this.nB === 0 || c >= this.maxC) break;
      const b = this.hB[0]!, pb = pops[b]!;
      if (W + pb < T || Math.abs(W + pb - T) < Math.abs(W - T)) {
        const x = this.popRoot(false); this.W += pops[x]!; this.insert(true, x); this.toggle(x); continue;
      }
      break;
    }
    this.needValidate = false;
  }

  /** Process every event in the direction of the next one; the current direction becomes it. */
  processGroup(): void {
    if (!this.hasNext()) return;
    this.curI = this.qI[0]!; this.curJ = this.qJ[0]!;
    while (this.hasNext() && crossDir(this.g, this.qI[0]!, this.qJ[0]!, this.curI, this.curJ) === 0) {
      const s = this.qS[0]!;
      this.qPop();
      this.events++;
      if (s === this.m) {
        if (this.nA > 0 && this.nB > 0 && !this.before(this.hA[0]!, this.hB[0]!)) {
          const a = this.popRoot(true), b = this.popRoot(false);
          this.insert(false, a); this.insert(true, b);
          this.W += this.g.pops[b]! - this.g.pops[a]!;
          this.toggle(a); this.toggle(b);
          this.needValidate = true;
        } else this.refreshCross();
      } else {
        const a = this.inA[s] === 1;
        const i = this.pos[s]!;
        if (i <= 0) continue;
        const H = this.H(a), qi = (i - 1) >> 1;
        if (!this.ok(a, s, H[qi]!)) {
          this.swap(a, i, qi);
          this.refreshTouched(a, [qi, i]);
        } else this.refresh(a, i);
      }
      if (this.needValidate) this.validate();
    }
  }
}
