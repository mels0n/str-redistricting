/**
 * The connected groups ("components") of one pass, kept up to date as blocks change class, so a
 * re-settle never has to walk the whole piece.
 *
 * Two neighbouring blocks are in the same group exactly when they have the same class: the same side in this pass,
 * and both pinned or both free (settle() in scan.ts groups blocks this way). A group's identity never matters to
 * the stray rule; only its blocks, population, block count and lowest block id do, and those are kept exact.
 *
 *  - A block joining a class merges the groups it touches (the smaller ones are relabelled into the largest).
 *  - A block leaving a group may split it. The pieces are found exactly by searching outward from each of its
 *    neighbours in turn, one step at a time; a search that runs out of blocks has found a whole piece, and the
 *    search stops when only one search is still running. The work is about the size of the pieces that broke
 *    away, never more than the group. There is no cap and no fallback.
 *  - The border between groups is kept as edge counts and exact lengths (whole micrometres) per pair of groups.
 */
import type { Piece } from './scan.js';
import { zob, zob2 } from './hash.js';

export interface Edge { n: number; len: number }

/** Working arrays for the searches; contents never carry over between calls (stamps are bumped). */
export class Scratch {
  readonly touchStamp: Int32Array; touchMark = 1;
  readonly owner: Int32Array; readonly seen: Int32Array; seenMark = 1;
  readonly q: Int32Array;
  constructor(m: number) { this.touchStamp = new Int32Array(m); this.owner = new Int32Array(m); this.seen = new Int32Array(m); this.q = new Int32Array(m); }
}

export class Groups {
  readonly label: Int32Array;
  cap = 0;
  pop = new Float64Array(0); cnt = new Int32Array(0); minId = new Float64Array(0); minStale = new Uint8Array(0);
  side = new Uint8Array(0); pin = new Uint8Array(0); alive = new Uint8Array(0); zobX = new Int32Array(0); zobY = new Int32Array(0); any = new Int32Array(0);
  nbr: (Map<number, Edge> | null)[] = [];
  private freeIds: number[] = [];
  /** Blocks whose group changed since the last clearTouched (moved, relabelled, or a member of a new group). */
  touched: number[] = [];
  private readonly s: Scratch;

  /** `scratch` is working space only; passes evaluated one after another on one thread can share it. */
  constructor(private readonly piece: Piece, private readonly blockSide: Uint8Array, private readonly blockPin: Uint8Array, scratch?: Scratch, label?: Int32Array) {
    this.label = label ?? new Int32Array(piece.m).fill(-1);
    this.s = scratch ?? new Scratch(piece.m);
  }

  /**
   * An exact copy of these groups for another pass, over that pass's side and pin arrays (which must, at the moment
   * of copying, hold the same values as this pass's). The copy is then brought to the other pass by the same
   * remove/add steps as any other change.
   */
  clone(blockSide: Uint8Array, blockPin: Uint8Array): Groups {
    const g = new Groups(this.piece, blockSide, blockPin, this.s, Int32Array.from(this.label));
    const n = this.cap;
    g.cap = n;
    g.pop = this.pop.slice(); g.cnt = this.cnt.slice(); g.minId = this.minId.slice(); g.minStale = this.minStale.slice();
    g.side = this.side.slice(); g.pin = this.pin.slice(); g.alive = this.alive.slice(); g.zobX = this.zobX.slice(); g.zobY = this.zobY.slice(); g.any = this.any.slice();
    g.freeIds = this.freeIds.slice();
    g.nbr = new Array(this.nbr.length).fill(null);
    for (let c = 0; c < n; c++) if (this.alive[c]) g.nbr[c] = new Map();
    for (let c = 0; c < n; c++) {
      if (!this.alive[c]) continue;
      for (const [d, e] of this.nbr[c]!) if (c < d) { const ne = { n: e.n, len: e.len }; g.nbr[c]!.set(d, ne); g.nbr[d]!.set(c, ne); }
    }
    return g;
  }

  private sameClass(a: number, b: number) { return this.blockSide[a] === this.blockSide[b] && this.blockPin[a] === this.blockPin[b]; }

  private newGroup(side: number, pin: number): number {
    let c = this.freeIds.pop();
    if (c === undefined) {
      c = this.cap;
      if (c >= this.pop.length) this.grow(Math.max(64, this.pop.length * 2));
      this.cap++;
    }
    this.pop[c] = 0; this.cnt[c] = 0; this.minId[c] = Infinity; this.minStale[c] = 0;
    this.side[c] = side; this.pin[c] = pin; this.alive[c] = 1; this.zobX[c] = 0; this.zobY[c] = 0; this.any[c] = -1;
    this.nbr[c] = new Map();
    return c;
  }
  private grow(n: number) {
    const g = <T extends Float64Array | Int32Array | Uint8Array>(a: T, C: { new (n: number): T }): T => { const b = new C(n); b.set(a); return b; };
    this.pop = g(this.pop, Float64Array); this.cnt = g(this.cnt, Int32Array); this.minId = g(this.minId, Float64Array); this.minStale = g(this.minStale, Uint8Array);
    this.side = g(this.side, Uint8Array); this.pin = g(this.pin, Uint8Array); this.alive = g(this.alive, Uint8Array); this.zobX = g(this.zobX, Int32Array); this.zobY = g(this.zobY, Int32Array); this.any = g(this.any, Int32Array);
  }
  private kill(c: number) { this.alive[c] = 0; this.nbr[c] = null; this.freeIds.push(c); }

  private touch(x: number) { if (this.s.touchStamp[x] !== this.s.touchMark) { this.s.touchStamp[x] = this.s.touchMark; this.touched.push(x); } }
  clearTouched() { this.touched.length = 0; if (++this.s.touchMark > 0x7ffffff0) { this.s.touchStamp.fill(0); this.s.touchMark = 1; } }

  private incEdge(a: number, b: number, len: number) {
    let e = this.nbr[a]!.get(b);
    if (!e) { e = { n: 0, len: 0 }; this.nbr[a]!.set(b, e); this.nbr[b]!.set(a, e); }
    e.n++; e.len += len;
  }
  private decEdge(a: number, b: number, len: number) {
    const e = this.nbr[a]!.get(b)!;
    e.n--; e.len -= len;
    if (e.n === 0) { this.nbr[a]!.delete(b); this.nbr[b]!.delete(a); }
  }

  /** Every group from scratch (start of a pass). */
  buildAll() {
    const { m, lOff, lAdj, lLen, pops, ids } = this.piece;
    this.label.fill(-1); this.cap = 0; this.freeIds = []; this.nbr = [];
    const q = this.s.q;
    for (let v = 0; v < m; v++) {
      if (this.label[v] !== -1) continue;
      const c = this.newGroup(this.blockSide[v]!, this.blockPin[v]!);
      let top = 0; q[top++] = v; this.label[v] = c;
      let pp = 0, cn = 0, mi = Infinity, zx = 0, zy = 0;
      while (top > 0) {
        const u = q[--top]!;
        pp += pops[u]!; cn++; if (ids[u]! < mi) mi = ids[u]!; zx ^= zob(u); zy ^= zob2(u);
        for (let k = lOff[u]!; k < lOff[u + 1]!; k++) {
          const j = lAdj[k]!;
          if (this.label[j] === -1 && this.sameClass(u, j)) { this.label[j] = c; q[top++] = j; }
        }
      }
      this.pop[c] = pp; this.cnt[c] = cn; this.minId[c] = mi; this.zobX[c] = zx; this.zobY[c] = zy; this.any[c] = v;
    }
    for (let u = 0; u < m; u++) {
      for (let k = lOff[u]!; k < lOff[u + 1]!; k++) {
        const j = lAdj[k]!;
        if (u < j && this.label[u] !== this.label[j]) this.incEdge(this.label[u]!, this.label[j]!, lLen[k]!);
      }
    }
  }

  /** Block x leaves its group (its class is about to change). */
  remove(x: number) {
    const { lOff, lAdj, lLen, pops, ids } = this.piece;
    const c = this.label[x]!;
    for (let k = lOff[x]!; k < lOff[x + 1]!; k++) {
      const d = this.label[lAdj[k]!]!;
      if (d !== c) this.decEdge(c, d, lLen[k]!);
    }
    this.pop[c] = this.pop[c]! - pops[x]!; this.cnt[c] = this.cnt[c]! - 1; this.zobX[c] = this.zobX[c]! ^ zob(x); this.zobY[c] = this.zobY[c]! ^ zob2(x);
    if (ids[x] === this.minId[c]) this.minStale[c] = 1;
    this.label[x] = -1; this.touch(x);
    if (this.cnt[c] === 0) { this.kill(c); return; }
    // x's neighbours inside c: the starts of the split search.
    const starts: number[] = [];
    for (let k = lOff[x]!; k < lOff[x + 1]!; k++) { const j = lAdj[k]!; if (this.label[j] === c && !starts.includes(j)) starts.push(j); }
    if (this.any[c] === x) this.any[c] = starts[0] ?? -1;
    if (starts.length >= 2) this.split(c, starts);
  }

  /**
   * Search outward from every start in turn, one block at a time per search. Searches that meet are joined. A
   * search that runs out of blocks has found a whole piece cut off from the others; stop once one search is left.
   */
  private split(c: number, starts: number[]) {
    const { lOff, lAdj } = this.piece;
    const k0 = starts.length;
    const parent = starts.map((_, i) => i);
    const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]!]!; i = parent[i]!; } return i; };
    const queues: number[][] = starts.map((s) => [s]);
    const heads = starts.map(() => 0);
    const members: number[][] = starts.map((s) => [s]);
    const closed = starts.map(() => false);
    if (++this.s.seenMark > 0x7ffffff0) { this.s.seen.fill(0); this.s.seenMark = 1; }
    const mark = this.s.seenMark;
    starts.forEach((s, i) => { this.s.seen[s] = mark; this.s.owner[s] = i; });
    let active = k0;
    while (active > 1) {
      for (let r = 0; r < k0 && active > 1; r++) {
        if (find(r) !== r || closed[r]) continue;
        const Q = queues[r]!;
        if (heads[r]! >= Q.length) { closed[r] = true; active--; continue; }
        const u = Q[heads[r]!++]!;
        let cur = r;
        for (let k = lOff[u]!; k < lOff[u + 1]!; k++) {
          const j = lAdj[k]!;
          if (this.label[j] !== c) continue;
          if (this.s.seen[j] !== mark) { this.s.seen[j] = mark; this.s.owner[j] = cur; queues[cur]!.push(j); members[cur]!.push(j); continue; }
          const o = find(this.s.owner[j]!);
          if (o !== cur) {
            // Two searches met: one piece. Keep the larger search's lists.
            const [big, small] = members[o]!.length >= members[cur]!.length ? [o, cur] : [cur, o];
            parent[small] = big;
            const qs = queues[small]!, qb = queues[big]!;
            for (let i = heads[small]!; i < qs.length; i++) qb.push(qs[i]!);
            for (const b of members[small]!) members[big]!.push(b);
            queues[small] = []; members[small] = []; heads[small] = 0;
            active--;
            cur = big;
          }
        }
      }
    }
    // Closed searches are pieces cut off from the rest; the one still running (or, if all closed, the largest) keeps c.
    const roots = parent.map((_, i) => i).filter((i) => find(i) === i);
    let keep = roots.find((r) => !closed[r]);
    if (keep === undefined) keep = roots.reduce((a, b) => (members[a]!.length >= members[b]!.length ? a : b));
    this.any[c] = starts[keep]!;
    for (const r of roots) if (r !== keep) this.carve(c, members[r]!);
  }

  /** Move a whole cut-off piece of c (all its blocks) into a new group of the same class. */
  private carve(c: number, blocks: number[]) {
    const { lOff, lAdj, lLen, pops, ids } = this.piece;
    const n = this.newGroup(this.side[c]!, this.pin[c]!);
    let pp = 0, mi = Infinity, zx = 0, zy = 0;
    for (const u of blocks) { this.label[u] = n; pp += pops[u]!; if (ids[u]! < mi) mi = ids[u]!; zx ^= zob(u); zy ^= zob2(u); this.touch(u); }
    this.pop[n] = pp; this.cnt[n] = blocks.length; this.minId[n] = mi; this.zobX[n] = zx; this.zobY[n] = zy; this.any[n] = blocks[0]!;
    this.pop[c] = this.pop[c]! - pp; this.cnt[c] = this.cnt[c]! - blocks.length; this.zobX[c] = this.zobX[c]! ^ zx; this.zobY[c] = this.zobY[c]! ^ zy;
    if (mi === this.minId[c]) this.minStale[c] = 1;
    for (const u of blocks) {
      for (let k = lOff[u]!; k < lOff[u + 1]!; k++) {
        const d = this.label[lAdj[k]!]!;
        if (d === n || d === -1) continue;
        this.decEdge(c, d, lLen[k]!); this.incEdge(n, d, lLen[k]!);
      }
    }
  }

  /** Block x (label -1) joins its current class: merges every touching group of that class. */
  add(x: number) {
    const { lOff, lAdj, lLen, pops, ids } = this.piece;
    const touching: number[] = [];
    for (let k = lOff[x]!; k < lOff[x + 1]!; k++) {
      const j = lAdj[k]!;
      const d = this.label[j]!;
      if (d >= 0 && this.sameClass(x, j) && !touching.includes(d)) touching.push(d);
    }
    let c: number;
    if (touching.length === 0) c = this.newGroup(this.blockSide[x]!, this.blockPin[x]!);
    else {
      c = touching.reduce((a, b) => (this.cnt[a]! >= this.cnt[b]! ? a : b));
      for (const d of touching) if (d !== c) this.merge(d, c);
    }
    this.label[x] = c; this.touch(x);
    this.pop[c] = this.pop[c]! + pops[x]!; this.cnt[c] = this.cnt[c]! + 1; this.zobX[c] = this.zobX[c]! ^ zob(x); this.zobY[c] = this.zobY[c]! ^ zob2(x);
    if (!this.minStale[c] && ids[x]! < this.minId[c]!) this.minId[c] = ids[x]!;
    if (this.any[c] === -1) this.any[c] = x;
    for (let k = lOff[x]!; k < lOff[x + 1]!; k++) {
      const d = this.label[lAdj[k]!]!;
      if (d >= 0 && d !== c) this.incEdge(c, d, lLen[k]!);
    }
  }

  /** Relabel group d into group c (same class, now joined). */
  private merge(d: number, c: number) {
    const { lOff, lAdj } = this.piece;
    const q = this.s.q;
    let top = 0;
    q[top++] = this.any[d]!; this.label[this.any[d]!] = c; this.touch(this.any[d]!);
    while (top > 0) {
      const u = q[--top]!;
      for (let k = lOff[u]!; k < lOff[u + 1]!; k++) {
        const j = lAdj[k]!;
        if (this.label[j] === d) { this.label[j] = c; this.touch(j); q[top++] = j; }
      }
    }
    for (const [e, ed] of this.nbr[d]!) {
      if (e === c) { this.nbr[c]!.delete(d); continue; }
      this.nbr[e]!.delete(d);
      const ce = this.nbr[c]!.get(e);
      if (ce) { ce.n += ed.n; ce.len += ed.len; }
      else { const ne = { n: ed.n, len: ed.len }; this.nbr[c]!.set(e, ne); this.nbr[e]!.set(c, ne); }
    }
    this.pop[c] = this.pop[c]! + this.pop[d]!; this.cnt[c] = this.cnt[c]! + this.cnt[d]!; this.zobX[c] = this.zobX[c]! ^ this.zobX[d]!; this.zobY[c] = this.zobY[c]! ^ this.zobY[d]!;
    if (this.minStale[d] || this.minStale[c]) this.minStale[c] = 1; else this.minId[c] = Math.min(this.minId[c]!, this.minId[d]!);
    this.kill(d);
  }

  /** Exact lowest block id of every group whose minimum left it. */
  resolveMins() {
    const { ids, lOff, lAdj } = this.piece;
    for (let c = 0; c < this.cap; c++) {
      if (!this.alive[c] || !this.minStale[c]) continue;
      let mi = Infinity, top = 0;
      const q = this.s.q;
      if (++this.s.seenMark > 0x7ffffff0) { this.s.seen.fill(0); this.s.seenMark = 1; }
      const mark = this.s.seenMark;
      q[top++] = this.any[c]!; this.s.seen[this.any[c]!] = mark;
      while (top > 0) {
        const u = q[--top]!;
        if (ids[u]! < mi) mi = ids[u]!;
        for (let k = lOff[u]!; k < lOff[u + 1]!; k++) { const j = lAdj[k]!; if (this.label[j] === c && this.s.seen[j] !== mark) { this.s.seen[j] = mark; q[top++] = j; } }
      }
      this.minId[c] = mi; this.minStale[c] = 0;
    }
  }

  /** Blocks of group c (by a search over its label). */
  membersOf(c: number, out: number[]) {
    const { lOff, lAdj } = this.piece;
    if (++this.s.seenMark > 0x7ffffff0) { this.s.seen.fill(0); this.s.seenMark = 1; }
    const mark = this.s.seenMark, q = this.s.q;
    let top = 0;
    q[top++] = this.any[c]!; this.s.seen[this.any[c]!] = mark;
    while (top > 0) {
      const u = q[--top]!; out.push(u);
      for (let k = lOff[u]!; k < lOff[u + 1]!; k++) { const j = lAdj[k]!; if (this.label[j] === c && this.s.seen[j] !== mark) { this.s.seen[j] = mark; q[top++] = j; } }
    }
  }
}
