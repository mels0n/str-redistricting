import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  connectedCase, cornerPair, cutOffGroup, endsCase, endsTrace, fixedCase, fixedOnFirst, islandBridge, islandsCase, mixedGroup, noRejoinCase,
  noRejoinTrace, outlineCase, recountCase, strayCases, whichStaysCase,
} from '../../../src/server/app/rule-examples/cases/strays.js';
import { createExtractContext, RuleCaseSchema, RuleExamplesSchema, type RuleCase } from '../../../src/server/features/rule-examples/index.js';
import { parseRuleExamplesConfig } from '../../../src/server/shared/config/index.js';
import { greatCircleDistance } from '../../../src/server/shared/geo/index.js';

// These read the generated plans (out/) and the cached census files (data/raw/); without them they skip.
const ctx = createExtractContext(parseRuleExamplesConfig([]));
const land = existsSync('data/raw/cb_2020_us_state_500k.zip');
const haveCO = existsSync('out/CO/cut-stats.json') && existsSync('data/raw/tl_2020_08_tabblock20.zip');
const haveAK = existsSync('out/AK/metrics.json') && existsSync('data/raw/tl_2020_02_tabblock20.zip');
const SLOW = 600_000;

type P = readonly [number, number];
const whole = (n: number): string => n.toLocaleString('en-US');
const numbers = (text: string): number[] => [...text.matchAll(/\d[\d,]*/g)].map((m) => Number(m[0].replaceAll(',', '')));
const label = (c: RuleCase, id: string): string => {
  const l = c.labels?.find((x) => x.id === id);
  if (!l) throw new Error(`no label ${id}`);
  return l.text;
};
const finalSet = (c: RuleCase, upTo = c.steps.length - 1): Record<string, string> =>
  Object.assign({}, ...c.steps.slice(0, upTo + 1).map((s) => s.set ?? {})) as Record<string, string>;
const blockId = (c: RuleCase, geoid: string): string => {
  const b = c.blocks?.find((x) => x.geoid === geoid);
  if (!b) throw new Error(`block ${geoid} is not in ${c.id}`);
  return b.id;
};
const segDist = (p: P, a: P, b: P): number => {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  const x = a[0] + t * dx - p[0], y = a[1] + t * dy - p[1];
  return Math.sqrt(x * x + y * y);
};
const distToLine = (p: P, pts: readonly P[]): number => {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) best = Math.min(best, segDist(p, pts[i - 1]!, pts[i]!));
  return best;
};
const shape = (c: RuleCase): void => {
  RuleCaseSchema.parse(c);
  expect(c.stateName.length).toBeGreaterThan(2);
  expect(c.steps.length).toBeGreaterThanOrEqual(3);
  expect(c.steps.length).toBeLessThanOrEqual(7);
  const text = [...c.steps.map((s) => s.caption), ...(c.labels ?? []).map((l) => l.text)].join('\n');
  expect(text).not.toContain('—');
  const ids = [...(c.blocks ?? []), ...(c.lines ?? []), ...(c.labels ?? [])].map((x) => x.id);
  expect(new Set(ids).size).toBe(ids.length);
  for (const s of c.steps) for (const id of [...s.show, ...(s.hide ?? []), ...Object.keys(s.set ?? {}), ...(s.tween ?? []).map((t) => t.id)]) expect(ids).toContain(id);
};
const json = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8').replace(/^﻿/, '')) as T;
interface Cands { fields: string[]; cuts: number[][][] }

describe('stage 3 stray-piece cases', () => {
  it.skipIf(!haveCO)('which-stays ranks groups by people, then blocks, then lowest GEOID and the main body is first', async () => {
    const c = await whichStaysCase(ctx);
    shape(c);
    const { t, sweep, group } = (await cutOffGroup(ctx))!;
    // The generator's main body is the first group under the stated ranking.
    const ranked = [...sweep.groups].sort((p, q) => q.pop - p.pop || q.blocks.length - p.blocks.length || Math.min(...p.blocks) - Math.min(...q.blocks));
    expect(ranked[0]!.main).toBe(true);
    expect(sweep.groups.filter((g) => g.main).length).toBe(1);
    const main = ranked[0]!;
    expect(group.main).toBe(false);
    expect(group.blocks.length).toBeGreaterThanOrEqual(2);
    // The panel names the main body first, with the generator's numbers, then the cut-off group.
    expect(numbers(label(c, 'main'))).toEqual([main.pop, main.blocks.length]);
    expect(numbers(label(c, 'group'))).toEqual([group.pop, group.blocks.length]);
    expect(c.labels!.findIndex((l) => l.id === 'main')).toBeLessThan(c.labels!.findIndex((l) => l.id === 'group'));
    // The group is drawn, and it ends on the other side.
    const other = sweep.side === 0 ? 'high' : 'low';
    const set = finalSet(c);
    for (const b of group.blocks) expect(set[blockId(c, t.blocks[b]!.geoid)]).toBe(other);
    expect(c.blocks!.length).toBe(group.blocks.length + 20);
  }, SLOW);

  it.skipIf(!haveCO)('fixed blocks keep their side through the re-count', async () => {
    const c = await fixedCase(ctx);
    shape(c);
    const { t, tr, pass, group } = (await cutOffGroup(ctx))!;
    const next = tr.passes[pass + 1]!;
    const other = tr.passes[pass]!.walkLow.includes(group.blocks[0]!) ? 'high' : 'low';
    for (const b of group.blocks) {
      expect(tr.passes[pass]!.moved.includes(b)).toBe(true);
      expect((other === 'high' ? next.fixedHigh : next.fixedLow).includes(b)).toBe(true);
      expect((other === 'high' ? tr.high : tr.low).includes(b)).toBe(true);
    }
    // Once moved, the group shows the new side at every later step, with a dot on each of its blocks.
    const firstMove = c.steps.findIndex((s) => group.blocks.some((b) => s.set?.[blockId(c, t.blocks[b]!.geoid)] === other));
    expect(firstMove).toBeGreaterThan(0);
    for (let i = firstMove; i < c.steps.length; i++) {
      const set = finalSet(c, i);
      for (const b of group.blocks) expect(set[blockId(c, t.blocks[b]!.geoid)]).toBe(other);
    }
    const pins = (c.lines ?? []).filter((l) => l.tag === 'point' && l.id.startsWith('pin'));
    expect(pins.length).toBe(group.blocks.length);
  }, SLOW);

  it.skipIf(!haveCO)('fixed shows a cut-off group whose free blocks move while its fixed blocks stay', async () => {
    const c = await fixedCase(ctx);
    shape(c);
    const mix = await mixedGroup(ctx);
    expect(mix).toBeDefined();
    const { t, tr, pass, sweep, group, before, after } = mix!;
    expect(tr.unresolved).toBe(true);
    expect(group.main).toBe(false);
    expect(group.fixed.length).toBeGreaterThan(0);
    expect(group.fixed.length).toBeLessThan(group.blocks.length);
    expect(tr.passes[pass]!.sweeps).toContain(sweep);
    const free = [...group.blocks].filter((b) => !group.fixed.includes(b));
    // In the trace: the free blocks move in this pass. The fixed ones keep their side through this sweep
    // (one may have been fixed by an earlier sweep of the same pass, so it can still be in the pass's moved list).
    for (const b of free) expect(tr.passes[pass]!.moved.includes(b)).toBe(true);
    for (const b of group.blocks) expect(before(b)).toBe(sweep.side);
    // In the panel: the last step shows free blocks on the other side and fixed blocks still on theirs.
    const other = sweep.side === 0 ? 'high' : 'low', own = sweep.side === 0 ? 'low' : 'high';
    const last = c.steps.at(-1)!.set ?? {};
    const idIn = (geoid: string) => c.blocks!.find((b) => b.geoid === geoid && b.id.startsWith('x'))!.id;
    for (const b of free) { expect(after(b)).not.toBe(sweep.side); expect(last[idIn(t.blocks[b]!.geoid)]).toBe(other); }
    for (const b of group.fixed) { expect(after(b)).toBe(sweep.side); expect(last[idIn(t.blocks[b]!.geoid)]).toBe(own); }
    expect(c.steps.at(-2)!.caption).toContain('count toward');
  }, SLOW);

  it.skipIf(!haveCO)('recount target equals share minus fixed people', async () => {
    const c = await recountCase(ctx);
    shape(c);
    const { t, tr, pass } = (await fixedOnFirst(ctx))!;
    const next = tr.passes[pass + 1]!;
    const fixedPeople = Array.from(next.fixedLow).reduce((s, b) => s + t.blocks[b]!.pop, 0);
    expect(fixedPeople).toBeGreaterThan(0);
    expect(next.target).toBe(tr.share - fixedPeople);
    expect(numbers(label(c, 'share'))).toEqual([tr.share]);
    expect(numbers(label(c, 'fixed'))).toEqual([fixedPeople]);
    expect(numbers(label(c, 'target'))).toEqual([next.target]);
    // The bar visibly moves from the share to the target.
    const fill = c.lines!.find((l) => l.id === 'fill')!;
    const to = c.steps.flatMap((s) => s.tween ?? []).find((x) => x.id === 'fill')!.to;
    expect(Math.abs(fill.pts.at(-1)![0] - to.at(-1)![0])).toBeGreaterThanOrEqual(30);
  }, SLOW);

  it.skipIf(!(haveCO && land))('ends shows exactly iterations passes and the last moves nothing', async () => {
    const c = await endsCase(ctx);
    shape(c);
    const { t, tr, row } = await endsTrace(ctx);
    const cands = json<Cands>('out/CO/candidates.json');
    const f = (n: string) => cands.fields.indexOf(n);
    const resolved = cands.cuts[0]!.filter((r) => r[f('unresolved')] === 0);
    const most = Math.max(...resolved.map((r) => r[f('iterations')]!));
    const pick = resolved.filter((r) => r[f('iterations')] === most).sort((p, q) => p[f('k')]! - q[f('k')]! || p[f('lowSeats')]! - q[f('lowSeats')]!)[0]!;
    expect([row.k, row.lowSeats]).toEqual([pick[f('k')], pick[f('lowSeats')]]);
    expect(tr.passes.length).toBe(most);
    // An overview step, then one step per pass.
    expect(c.steps.length).toBe(most + 1);
    c.steps.slice(1).forEach((s, i) => expect(s.caption.startsWith(`Pass ${i + 1}`)).toBe(true));
    tr.passes.forEach((p, i) => expect((c.lines ?? []).filter((l) => l.id.startsWith(`m${i + 1}-`)).length).toBe(p.moved.length));
    expect(tr.passes.at(-1)!.moved.length).toBe(0);
    expect(c.steps.at(-1)!.caption).toContain('moves no free block');
    // Every pass that moves blocks highlights blocks of its own, never shown before, each big enough to see.
    const byId = new Map((c.blocks ?? []).map((b) => [b.id, b]));
    const seen = new Set<string>(c.steps[0]!.show);
    for (let i = 0; i < most - 1; i++) {
      const step = c.steps[i + 1]!;
      const hot = Object.entries(step.set ?? {}).filter(([, v]) => v === 'hot').map(([id]) => id);
      expect(hot.length, `pass ${i + 1}`).toBeGreaterThan(0);
      for (const id of hot) {
        expect(seen.has(id), `${id} shown before pass ${i + 1}`).toBe(false);
        expect(step.show).toContain(id);
        const xs = byId.get(id)!.ring.map((p) => p[0]), ys = byId.get(id)!.ring.map((p) => p[1]);
        expect(Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))).toBeGreaterThanOrEqual(3);
        // A moved block of this pass, by GEOID.
        expect(tr.passes[i]!.moved.some((b) => t.blocks[b]!.geoid === byId.get(id)!.geoid)).toBe(true);
      }
      for (const id of step.show) seen.add(id);
    }
    // The last step settles the last close-up: its highlighted blocks take their final side.
    const prev = c.steps.at(-2)!.set ?? {}, end = c.steps.at(-1)!.set ?? {};
    expect(Object.keys(prev).filter((id) => prev[id] === 'hot' && (end[id] === 'low' || end[id] === 'high')).length).toBeGreaterThan(0);
  }, SLOW);

  it.skipIf(!haveCO)('no-rejoin candidate is unresolved in candidates.json', async () => {
    const c = await noRejoinCase(ctx);
    shape(c);
    const { t, tr, row, group } = (await noRejoinTrace(ctx))!;
    const cands = json<Cands>('out/CO/candidates.json');
    const f = (n: string) => cands.fields.indexOf(n);
    const first = cands.cuts[0]!.filter((r) => r[f('unresolved')] === 1).sort((p, q) => p[f('k')]! - q[f('k')]! || p[f('lowSeats')]! - q[f('lowSeats')]!)[0]!;
    expect([row.k, row.lowSeats]).toEqual([first[f('k')], first[f('lowSeats')]]);
    expect(tr.unresolved).toBe(true);
    expect(c.source.angleDeg).toBeCloseTo(tr.angleDeg, 9);
    // The stranded group is fixed, cut off in the last pass, and nothing moved in that pass.
    const last = tr.passes.at(-1)!;
    expect(last.moved.length).toBe(0);
    expect(group.main).toBe(false);
    expect(group.fixed.length).toBe(group.blocks.length);
    expect(last.sweeps.some((s) => s.groups.some((g) => g.blocks.length === group.blocks.length && g.blocks.every((b, i) => b === group.blocks[i])))).toBe(true);
    for (const b of group.blocks) expect(blockId(c, t.blocks[b]!.geoid)).toBeDefined();
    expect(c.steps.at(-1)!.caption).toContain('next shortest line');
  }, SLOW);

  it.skipIf(!(haveCO && existsSync('public/data/CO/cuts.json')))('outline marks one crossing per line endpoint inside the state', async () => {
    const c = await outlineCase(ctx);
    shape(c);
    const cuts = json<{ order: number; lines: [number, number][][] }[]>('public/data/CO/cuts.json');
    const cut2 = cuts.find((x) => x.order === 2)!;
    expect(cut2.lines.length).toBe(2);
    const crossings = (c.lines ?? []).filter((l) => l.tag === 'crossing');
    expect(crossings.length).toBe(2 * cut2.lines.length);
    // Each mark sits where a drawn span of the line meets the drawn outline of the piece.
    const outline = c.lines!.filter((l) => l.id.startsWith('outline'));
    const spans = c.lines!.filter((l) => l.tag === 'cut');
    expect(spans.length).toBe(cut2.lines.length);
    for (const x of crossings) {
      const p = x.pts[0]!;
      expect(Math.min(...spans.map((s) => distToLine(p, s.pts)))).toBeLessThanOrEqual(0.2);
      expect(Math.min(...outline.map((o) => distToLine(p, o.pts)))).toBeLessThanOrEqual(1.5);
    }
  }, SLOW);

  it.skipIf(!haveCO)('connected pair shares no edge in topo but shares a vertex', async () => {
    const c = await connectedCase(ctx);
    shape(c);
    const { a, b, c: n } = await cornerPair(ctx);
    const { blocks, topo } = await ctx.blocks('CO');
    const adjacent = (u: number, v: number) => topo.adjList.subarray(topo.adjOffsets[u]!, topo.adjOffsets[u + 1]!).includes(v);
    expect(adjacent(a, b)).toBe(false);
    expect(adjacent(a, n)).toBe(true);
    const key = (p: readonly number[]) => `${Math.round(p[0]! * 1e7)},${Math.round(p[1]! * 1e7)}`;
    const va = new Set(blocks[a]!.rings.flat().map(key));
    expect(blocks[b]!.rings.flat().some((p) => va.has(key(p)))).toBe(true);
    // No earlier pair in GEOID order touches only at a corner.
    expect(a).toBeLessThan(b);
    for (const g of [blocks[a]!, blocks[b]!, blocks[n]!]) blockId(c, g.geoid);
  }, SLOW);

  it.skipIf(!haveAK)('islands bridge endpoints are the island block and its nearest main-body block', async () => {
    const c = await islandsCase(ctx);
    shape(c);
    const pick = await islandBridge(ctx);
    expect(pick).toBeDefined();
    const { abbr, island, islandBlock, mainBlock } = pick!;
    expect(abbr).toBe('AK');
    const { blocks, topo } = await ctx.blocks(abbr);
    expect(topo.bridges.some(([u, v]) => (u === islandBlock && v === mainBlock) || (u === mainBlock && v === islandBlock))).toBe(true);
    expect(island).toContain(islandBlock);
    // The main body: the largest group of blocks linked by shared edges alone (bridges left out).
    const bridged = new Set(topo.bridges.map(([u, v]) => `${Math.min(u, v)},${Math.max(u, v)}`));
    const comp = new Int32Array(topo.n).fill(-1);
    const sizes: number[] = [];
    for (let s = 0; s < topo.n; s++) {
      if (comp[s] !== -1) continue;
      const id = sizes.length, stack = [s];
      let size = 0;
      comp[s] = id;
      while (stack.length) {
        const u = stack.pop()!;
        size++;
        for (let k = topo.adjOffsets[u]!; k < topo.adjOffsets[u + 1]!; k++) {
          const v = topo.adjList[k]!;
          if (comp[v] === -1 && !bridged.has(`${Math.min(u, v)},${Math.max(u, v)}`)) { comp[v] = id; stack.push(v); }
        }
      }
      sizes.push(size);
    }
    const main = sizes.indexOf(Math.max(...sizes));
    expect(comp[mainBlock]).toBe(main);
    expect(island.every((b) => comp[b] === comp[islandBlock] && comp[b] !== main)).toBe(true);
    expect(sizes[comp[islandBlock]!]).toBe(island.length);
    // Brute force: of every island block and every main-body block, the bridge is the closest pair.
    let best = Infinity;
    for (const u of island) for (let v = 0; v < blocks.length; v++) {
      if (comp[v] === main) best = Math.min(best, greatCircleDistance(blocks[u]!.point, blocks[v]!.point));
    }
    expect(greatCircleDistance(blocks[islandBlock]!.point, blocks[mainBlock]!.point)).toBe(best);
    blockId(c, blocks[islandBlock]!.geoid);
    blockId(c, blocks[mainBlock]!.geoid);
    expect(c.steps.map((s) => s.caption).join(' ')).toContain(`${whole(island.length)} blocks`);
    // Detached land is joined by the shortest set of links, which may reach another island.
    expect(c.steps.at(-1)!.caption).toContain('shortest links that connect every piece');
    expect(c.steps.map((s) => s.caption).join(' ')).not.toContain('joined the same way');
  }, SLOW);

  it('registers the eight cases', () => {
    expect(strayCases.length).toBe(8);
  });
});

describe('committed rule-examples.json carries the stray-piece panels', () => {
  const file = RuleExamplesSchema.parse(JSON.parse(readFileSync('public/data/how/rule-examples.json', 'utf8')));
  it('has every stage 3 case with shapes or an honest missing note', () => {
    for (const id of ['strays.which-stays', 'strays.fixed', 'strays.recount', 'strays.ends', 'strays.no-rejoin', 'strays.outline', 'strays.connected', 'strays.islands']) {
      const c = file.cases.find((x) => x.id === id);
      expect(c, id).toBeDefined();
      if (c!.missing === undefined) expect((c!.blocks?.length ?? 0) + (c!.lines?.length ?? 0)).toBeGreaterThan(0);
    }
  });
});
