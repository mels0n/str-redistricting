/**
 * One candidate's evaluation, kept up to date as the direction turns: the same passes as the engine's original
 * evaluate() (a whole-block split, the strays rule, re-counts over the free blocks until a settle moves nothing),
 * with every pass's split taken from its own exact Tracker and every pass's connected groups kept by Groups.
 *
 * When a tracker moves blocks across its split:
 *   1. pins from the pass before arrive as a short list; the tracker drops or takes those blocks and re-applies the
 *      stopping rule in place, and each listed block changes class in the groups;
 *   2. blocks the tracker moved change side in the groups;
 *   3. the strays rule (settleStrays) runs on the list of groups, which is exactly the list a walk over every block
 *      would find; the blocks whose pin changed go on to the next pass as its short list.
 * A pass that starts pinning blocks gets a next pass, built from it (its groups copied, then the differing blocks
 * moved); a pass that stops pinning drops the passes after it. Border lengths are whole micrometres summed per
 * pair of groups, so every total is exact in any order.
 */
import { selectLow, settleStrays, type Piece } from './scan.js';
import { Groups, Scratch } from './groups.js';
import { crossDir, Tracker, type Geo } from './tracker.js';

interface Pass {
  tr: Tracker;
  fixedBefore: Int8Array;
  side: Uint8Array;
  pinned: Uint8Array;
  g: Groups;
  newly: Int8Array;
  newlyCount: number;
  stranded: boolean;
  flipPrev: Int8Array;
  fs: Uint8Array;
  fixedLowPop: number; fixedLow: number; fixedHigh: number; free: number;
}

export interface Stats2 {
  trackerEvents: number; groups: number; setChanges: number; resultChanges: number;
  localSettles: number; fullBuilds: number; derivedBuilds: number; dTrackerMs: number; dCloneMs: number; dApplyMs: number; reconfigs: number; trackerBuilds: number; passDeltas: number;
  ms: number; settleMs: number; groupMs: number; buildMs: number; selfChecks: number; selfCheckFails: number;
}

export class Chain {
  passes: Pass[] = [];
  private spares: Tracker[] = [];
  /** Border length of the current result in whole micrometres, people on its low side, its fingerprints, and whether a pinned stray was left stranded. */
  lengthUm = 0; lowPop = 0; h1 = 0; h2 = 0; unresolved = false;
  readonly stats: Stats2 = {
    trackerEvents: 0, groups: 0, setChanges: 0, resultChanges: 0, localSettles: 0, fullBuilds: 0, derivedBuilds: 0, dTrackerMs: 0, dCloneMs: 0, dApplyMs: 0, reconfigs: 0, trackerBuilds: 0, passDeltas: 0,
    ms: 0, settleMs: 0, groupMs: 0, buildMs: 0, selfChecks: 0, selfCheckFails: 0,
  };
  private readonly T0: number;
  private readonly scratch: Scratch;

  /** `fromScratch` builds every new pass with a full walk (the reference the self-checks compare against). */
  constructor(private readonly piece: Piece, private readonly geo: Geo, private readonly seats: number, private readonly lowSeats: number, private readonly fromScratch = false) {
    this.T0 = (piece.total * lowSeats) / seats;
    this.scratch = new Scratch(piece.m);
  }

  /** Some pass sits on an exact tie of its stopping rule (Tracker.atTie). */
  get atTie(): boolean { for (const P of this.passes) if (P.tr.atTie()) return true; return false; }

  get movedBlocks(): number { let s = 0; for (let q = 0; q < this.passes.length - 1; q++) s += this.passes[q]!.newlyCount; return s; }

  private target(P: Pass) {
    return { T: this.T0 - P.fixedLowPop, minC: P.fixedLow > 0 ? 0 : 1, maxC: P.free - (P.fixedHigh > 0 ? 0 : 1) };
  }

  private newTracker(free: Int32Array, T: number, minC: number, maxC: number, ci: number, cj: number): Tracker {
    const t0 = performance.now();
    const { px, py, ids, pops } = this.piece;
    const tr = new Tracker(this.geo, this.piece.m, free, T, minC, maxC, ci, cj, (fr, ux, uy) => {
      const n = fr.length;
      const K = new Float64Array(n), I = new Int32Array(n), P = new Float64Array(n), perm = new Int32Array(n);
      for (let i = 0; i < n; i++) { const x = fr[i]!; K[i] = px[x]! * uy - py[x]! * ux; I[i] = ids[x]!; P[i] = pops[x]!; }
      const count = selectLow(K, I, P, perm, T, minC, maxC);
      fr.set(Int32Array.from(perm, (i) => fr[i]!));
      return count;
    });
    this.stats.trackerBuilds++;
    this.stats.buildMs += performance.now() - t0;
    return tr;
  }

  /** A pass built from scratch at (ci, cj) for the given fixed blocks. */
  private buildPass(fixed: Int8Array, ci: number, cj: number): Pass {
    const t0 = performance.now();
    const { m, pops } = this.piece;
    let fixedLowPop = 0, fixedLow = 0, fixedHigh = 0, free = 0;
    for (let i = 0; i < m; i++) { const s = fixed[i]!; if (s < 0) free++; else if (s === 0) { fixedLowPop += pops[i]!; fixedLow++; } else fixedHigh++; }
    const T = this.T0 - fixedLowPop, minC = fixedLow > 0 ? 0 : 1, maxC = free - (fixedHigh > 0 ? 0 : 1);
    let tr = this.spares.shift();
    if (tr) { tr.reconfigure(fixed, T, minC, maxC, ci, cj); this.stats.reconfigs++; }
    else {
      const fr = new Int32Array(free);
      for (let i = 0, w = 0; i < m; i++) if (fixed[i]! < 0) fr[w++] = i;
      tr = this.newTracker(fr, T, minC, maxC, ci, cj);
    }
    tr.clearToggles();
    const side = new Uint8Array(m), pinned = new Uint8Array(m);
    for (let i = 0; i < m; i++) { if (fixed[i]! >= 0) { side[i] = fixed[i]!; pinned[i] = 1; } else side[i] = tr.inA[i] === 1 ? 0 : 1; }
    const g = new Groups(this.piece, side, pinned, this.scratch);
    g.buildAll();
    const P: Pass = {
      tr, fixedBefore: Int8Array.from(fixed), side, pinned, g, newly: new Int8Array(m).fill(-1), newlyCount: 0, stranded: false,
      flipPrev: new Int8Array(0), fs: new Uint8Array(0), fixedLowPop, fixedLow, fixedHigh, free,
    };
    this.stats.fullBuilds++;
    this.stats.buildMs += performance.now() - t0;
    this.settle(P, true);
    return P;
  }

  /**
   * The pass after `prev`, built from it: copy prev's groups, then change class for exactly the blocks that differ
   * (the ones prev pins, and free blocks the new re-count puts on the other side), with the same remove/add steps
   * as any other change. Ends at the same groups a full walk would find.
   */
  private buildPassFrom(prev: Pass, ci: number, cj: number): Pass {
    const t0 = performance.now();
    const { m, pops } = this.piece;
    const fixed = Int8Array.from(prev.fixedBefore);
    let fixedLowPop = prev.fixedLowPop, fixedLow = prev.fixedLow, fixedHigh = prev.fixedHigh, free = prev.free;
    const pinNow: number[] = [];
    for (let i = 0; i < m; i++) {
      const v = prev.newly[i]!;
      if (v < 0) continue;
      fixed[i] = v; pinNow.push(i); free--;
      if (v === 0) { fixedLow++; fixedLowPop += pops[i]!; } else fixedHigh++;
    }
    const T = this.T0 - fixedLowPop, minC = fixedLow > 0 ? 0 : 1, maxC = free - (fixedHigh > 0 ? 0 : 1);
    let tr = this.spares.shift();
    if (tr) { tr.reconfigure(fixed, T, minC, maxC, ci, cj); this.stats.reconfigs++; }
    else {
      const fr = new Int32Array(free);
      for (let i = 0, w = 0; i < m; i++) if (fixed[i]! < 0) fr[w++] = i;
      tr = this.newTracker(fr, T, minC, maxC, ci, cj);
    }
    tr.clearToggles();
    const t1 = performance.now();
    this.stats.dTrackerMs += t1 - t0;
    const side = prev.side.slice(), pinned = prev.pinned.slice();
    const g = prev.g.clone(side, pinned);
    const t2 = performance.now();
    this.stats.dCloneMs += t2 - t1;
    for (const i of pinNow) { g.remove(i); side[i] = fixed[i]!; pinned[i] = 1; g.add(i); }
    for (let i = 0; i < m; i++) {
      if (fixed[i]! >= 0) continue;
      const ns = tr.inA[i] === 1 ? 0 : 1;
      if (side[i] !== ns) { g.remove(i); side[i] = ns; g.add(i); }
    }
    const P: Pass = {
      tr, fixedBefore: fixed, side, pinned, g, newly: new Int8Array(m).fill(-1), newlyCount: 0, stranded: false,
      flipPrev: new Int8Array(0), fs: new Uint8Array(0), fixedLowPop, fixedLow, fixedHigh, free,
    };
    this.stats.derivedBuilds++;
    this.stats.dApplyMs += performance.now() - t2;
    this.stats.buildMs += performance.now() - t0;
    this.settle(P, true);
    return P;
  }

  /** The stray rule on the groups of pass P. Returns the blocks whose pin from this pass changed. */
  private settle(P: Pass, fresh = false): number[] {
    const t0 = performance.now();
    const g = P.g;
    g.resolveMins();
    const cap = g.cap;
    const idx = new Int32Array(cap).fill(-1), ids: number[] = [];
    for (let c = 0; c < cap; c++) if (g.alive[c]) { idx[c] = ids.length; ids.push(c); }
    const n = ids.length;
    const off = new Int32Array(n + 1);
    for (let v = 0; v < n; v++) off[v + 1] = off[v]! + g.nbr[ids[v]!]!.size;
    const adj = new Int32Array(off[n]!);
    for (let v = 0, w = 0; v < n; v++) for (const d of g.nbr[ids[v]!]!.keys()) adj[w++] = idx[d]!;
    const side = new Uint8Array(n), pinned = new Uint8Array(n), pop = new Float64Array(n), cnt = new Float64Array(n), minIdx = new Float64Array(n);
    for (let v = 0; v < n; v++) { const c = ids[v]!; side[v] = g.side[c]!; pinned[v] = g.pin[c]!; pop[v] = g.pop[c]!; cnt[v] = g.cnt[c]!; minIdx[v] = g.minId[c]!; }
    P.stranded = settleStrays({ n, off, adj, pop, cnt, minIdx, side }, pinned);
    if (P.fs.length < cap) { const f = new Uint8Array(Math.max(cap, 2 * P.fs.length)); f.set(P.fs); P.fs = f; }
    if (P.flipPrev.length < cap) { const f = new Int8Array(Math.max(cap, 2 * P.flipPrev.length)).fill(-1); f.set(P.flipPrev); P.flipPrev = f; }
    for (let v = 0; v < n; v++) P.fs[ids[v]!] = side[v]!;
    // Blocks to re-check: those whose group changed, and every block of a group whose flip changed.
    const cand = fresh ? [] : g.touched.slice();
    for (let v = 0; v < n; v++) {
      const c = ids[v]!;
      const flip = !g.pin[c] && side[v] !== g.side[c] ? side[v]! : -1;
      if (flip !== P.flipPrev[c]) { g.membersOf(c, cand); P.flipPrev[c] = flip; }
    }
    const changes: number[] = [];
    for (const i of cand) {
      const c = g.label[i]!;
      const v = P.fixedBefore[i]! < 0 && !g.pin[c] && P.fs[c] !== g.side[c] ? P.fs[c]! : -1;
      if (v !== P.newly[i]) {
        if (P.newly[i]! < 0) P.newlyCount++; else if (v < 0) P.newlyCount--;
        P.newly[i] = v; changes.push(i);
      }
    }
    g.clearTouched();
    this.stats.localSettles++;
    this.stats.settleMs += performance.now() - t0;
    return changes;
  }

  private computeFinal() {
    const P = this.passes[this.passes.length - 1]!, g = P.g;
    let len = 0, lowPop = 0, h1 = 0, h2 = 0;
    for (let c = 0; c < g.cap; c++) {
      if (!g.alive[c]) continue;
      if (P.fs[c] === 0) { lowPop += g.pop[c]!; h1 ^= g.zobX[c]!; h2 ^= g.zobY[c]!; }
      for (const [d, e] of g.nbr[c]!) if (c < d && P.fs[c] !== P.fs[d]) len += e.len;
    }
    this.lengthUm = len; this.lowPop = lowPop; this.h1 = h1 >>> 0; this.h2 = h2 >>> 0; this.unresolved = P.stranded;
  }

  start(ci: number, cj: number) {
    const m = this.piece.m;
    this.passes = [this.buildPass(new Int8Array(m).fill(-1), ci, cj)];
    for (let q = 0; q < this.passes.length; q++) this.extend(q, ci, cj);
    this.computeFinal();
  }

  /** Keep the chain consistent from pass q on: drop passes after a pass that pins nothing, add one after a pass that does. */
  private extend(q: number, ci: number, cj: number): boolean {
    const P = this.passes[q]!;
    if (P.newlyCount === 0) {
      if (this.passes.length > q + 1) {
        for (const X of this.passes.splice(q + 1)) if (this.spares.length < 4) this.spares.push(X.tr);
        return true;
      }
      return false;
    }
    if (q === this.passes.length - 1) {
      if (this.passes.length > this.piece.m) throw new Error('re-count did not settle');
      if (this.fromScratch) {
        const fixed = Int8Array.from(P.fixedBefore);
        for (let i = 0; i < fixed.length; i++) if (fixed[i]! < 0 && P.newly[i]! >= 0) fixed[i] = P.newly[i]!;
        this.passes.push(this.buildPass(fixed, ci, cj));
      } else this.passes.push(this.buildPassFrom(P, ci, cj));
      return true;
    }
    return false;
  }

  /** Process the next event direction across every tracker. */
  step(): { changedSets: boolean; changedResult: boolean; ci: number; cj: number } | null {
    const all = [...this.passes.map((P) => P.tr), ...this.spares];
    let p = -1;
    for (let q = 0; q < all.length; q++) {
      const tr = all[q]!;
      if (!tr.hasNext()) continue;
      if (p < 0 || crossDir(this.geo, tr.nextI(), tr.nextJ(), all[p]!.nextI(), all[p]!.nextJ()) < 0) p = q;
    }
    if (p < 0) return null;
    const ci = all[p]!.nextI(), cj = all[p]!.nextJ();
    let any = false;
    for (let q = 0; q < all.length; q++) {
      const tr = all[q]!;
      if (tr.hasNext() && crossDir(this.geo, tr.nextI(), tr.nextJ(), ci, cj) === 0) {
        const ev = tr.events;
        tr.processGroup();
        this.stats.trackerEvents += tr.events - ev;
        this.stats.groups++;
        if (q >= this.passes.length) tr.clearToggles();
        else if (tr.netMoved().length) any = true;
      }
    }
    if (!any) { for (const P of this.passes) P.tr.clearToggles(); return { changedSets: false, changedResult: false, ci, cj }; }
    this.stats.setChanges++;
    const before = { len: this.lengthUm, h1: this.h1, h2: this.h2, unres: this.unresolved };
    let delta: number[] = [];
    for (let q = 0; q < this.passes.length; q++) {
      const P = this.passes[q]!;
      const t0 = performance.now();
      let changed = false;
      // 1. Pins from the pass before.
      const dBlocks: number[] = [], dFree: boolean[] = [];
      for (const i of delta) {
        const prev = this.passes[q - 1]!;
        const v = prev.fixedBefore[i]! >= 0 ? prev.fixedBefore[i]! : prev.newly[i]!;
        const old = P.fixedBefore[i]!;
        if (v === old) continue;
        if (old < 0) P.free--; else if (old === 0) { P.fixedLow--; P.fixedLowPop -= this.piece.pops[i]!; } else P.fixedHigh--;
        if (v < 0) P.free++; else if (v === 0) { P.fixedLow++; P.fixedLowPop += this.piece.pops[i]!; } else P.fixedHigh++;
        P.fixedBefore[i] = v;
        dBlocks.push(i); dFree.push(v < 0);
      }
      if (dBlocks.length) {
        this.stats.passDeltas++;
        const { T, minC, maxC } = this.target(P);
        P.tr.applyDelta(dBlocks, dFree, T, minC, maxC, ci, cj);
        for (const i of dBlocks) {
          P.g.remove(i);
          const v = P.fixedBefore[i]!;
          P.pinned[i] = v >= 0 ? 1 : 0;
          P.side[i] = v >= 0 ? v : P.tr.inA[i] === 1 ? 0 : 1;
          P.g.add(i);
        }
        changed = true;
      }
      // 2. Blocks the tracker moved.
      for (const x of P.tr.netMoved()) {
        if (P.fixedBefore[x]! >= 0) continue;
        const ns = P.tr.inA[x] === 1 ? 0 : 1;
        if (P.side[x] === ns) continue;
        P.g.remove(x); P.side[x] = ns; P.g.add(x);
        changed = true;
      }
      P.tr.clearToggles();
      this.stats.groupMs += performance.now() - t0;
      // 3. The stray rule on the groups; pass on what changed.
      const next: number[] = [];
      if (changed) {
        const pinChanges = this.settle(P);
        const seen = new Set<number>();
        for (const i of dBlocks) { seen.add(i); next.push(i); }
        for (const i of pinChanges) if (!seen.has(i)) next.push(i);
      }
      delta = next;
      if (this.extend(q, ci, cj)) { delta = []; if (this.passes.length <= q + 1) break; }
    }
    this.computeFinal();
    const changedResult = before.len !== this.lengthUm || before.h1 !== this.h1 || before.h2 !== this.h2 || before.unres !== this.unresolved;
    if (changedResult) this.stats.resultChanges++;
    return { changedSets: true, changedResult, ci, cj };
  }

  /** Final side of every block (0 = low), from the last pass's groups. */
  finalSides(): Uint8Array {
    const P = this.passes[this.passes.length - 1]!, out = new Uint8Array(this.piece.m);
    for (let i = 0; i < out.length; i++) out[i] = P.fs[P.g.label[i]!]!;
    return out;
  }

  /** Rebuild every pass from scratch at (ci, cj) and compare (validation only). */
  selfCheck(ci: number, cj: number): boolean {
    this.stats.selfChecks++;
    const ref = new Chain(this.piece, this.geo, this.seats, this.lowSeats, true);
    ref.start(ci, cj);
    let same = ref.lengthUm === this.lengthUm && ref.h1 === this.h1 && ref.h2 === this.h2 && ref.unresolved === this.unresolved && ref.passes.length === this.passes.length;
    for (let q = 0; same && q < this.passes.length; q++) {
      const a = this.passes[q]!, b = ref.passes[q]!;
      for (let i = 0; i < this.piece.m; i++) if (a.newly[i] !== b.newly[i] || a.fixedBefore[i] !== b.fixedBefore[i] || a.side[i] !== b.side[i]) {
        same = false;
        break;
      }
    }
    if (!same) this.stats.selfCheckFails++;
    return same;
  }
}
