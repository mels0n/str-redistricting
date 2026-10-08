import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  borderEdges, cutBothWaysCase, cutCases, cutGlobeCase, cutMeasureCase, cutOrderCase, cutTrace, cutWalkStopCase, walkTies,
} from '../../../src/server/app/rule-examples/cases/cut.js';
import { createExtractContext, RuleCaseSchema, RuleExamplesSchema, type RuleCase } from '../../../src/server/features/rule-examples/index.js';
import { selectLow } from '../../../src/server/features/splitline/index.js';
import { parseRuleExamplesConfig } from '../../../src/server/shared/config/index.js';
import { DataError } from '../../../src/server/shared/errors/index.js';

// These read the generated plans (out/) and the cached census files (data/raw/); without them they skip.
const ctx = createExtractContext(parseRuleExamplesConfig([]));
const land = existsSync('data/raw/cb_2020_us_state_500k.zip');
const haveCO = existsSync('out/CO/cut-stats.json') && existsSync('out/CO/cuts.geojson') && existsSync('data/raw/tl_2020_08_tabblock20.zip');
const haveAL = existsSync('out/AL/candidates.json') && existsSync('data/raw/tl_2020_01_tabblock20.zip');
const SLOW = 240_000;
/** Largest distance of any point from the line through the first and last, in panel units. */
const bow = (pts: readonly (readonly [number, number])[]): number => {
  const a = pts[0]!, b = pts.at(-1)!;
  const dx = b[0] - a[0], dy = b[1] - a[1], d = Math.sqrt(dx * dx + dy * dy);
  return Math.max(...pts.map((p) => Math.abs(dx * (a[1] - p[1]) - (a[0] - p[0]) * dy) / d));
};

const whole = (n: number): string => n.toLocaleString('en-US');
const label = (c: RuleCase, id: string): string => {
  const l = c.labels?.find((x) => x.id === id);
  if (!l) throw new Error(`no label ${id}`);
  return l.text;
};
const numberIn = (text: string): number => Number(/[\d,]+(\.\d+)?/.exec(text)![0].replaceAll(',', ''));
const lastTween = (c: RuleCase, id: string) => {
  for (let i = c.steps.length - 1; i >= 0; i--) {
    const t = c.steps[i]!.tween?.find((x) => x.id === id);
    if (t) return t.to;
  }
  return undefined;
};
const shape = (c: RuleCase): void => {
  RuleCaseSchema.parse(c);
  expect(c.steps.length).toBeGreaterThanOrEqual(3);
  expect(c.steps.length).toBeLessThanOrEqual(7);
  const text = [...c.steps.map((s) => s.caption), ...(c.labels ?? []).map((l) => l.text)].join('\n');
  expect(text).not.toContain('—');
  const ids = [...(c.blocks ?? []), ...(c.lines ?? []), ...(c.labels ?? [])].map((x) => x.id);
  expect(new Set(ids).size).toBe(ids.length);
  for (const s of c.steps) for (const id of [...s.show, ...Object.keys(s.set ?? {}), ...(s.tween ?? []).map((t) => t.id)]) expect(ids).toContain(id);
};

describe('stage 2 block-window cases', () => {
  it.skipIf(!haveCO)('cut.walk-stop numbers match the generator (CO cut 3)', async () => {
    const c = await cutWalkStopCase(ctx);
    shape(c);
    const t = await cutTrace(ctx, 'CO', 3);
    const tr = t.traces[0]!;
    // Walk arithmetic straight from the generator's selectLow over the traced order.
    const m = tr.order.length;
    const keys = Float64Array.from({ length: m }, (_, i) => i);
    const ids = Int32Array.from(tr.order);
    const pops = Float64Array.from(tr.order, (b) => t.blocks[b]!.pop);
    const count = selectLow(keys, ids, pops, new Int32Array(m), tr.share);
    const sum = (n: number) => pops.subarray(0, n).reduce((a, b) => a + b, 0);
    const joins = sum(count) >= tr.share;
    const crossing = joins ? count - 1 : count;
    const before = sum(crossing), after = sum(crossing + 1);
    expect(label(c, 'share')).toContain(whole(tr.share));
    expect(label(c, 'before')).toBe(whole(before));
    expect(label(c, 'after')).toBe(whole(after));
    expect(before).toBeLessThan(tr.share);
    expect(after).toBeGreaterThanOrEqual(tr.share);
    // The side the crossing block ends on agrees with the trace's first walk.
    const crossBlock = t.blocks[tr.order[crossing]!]!;
    const cross = c.blocks!.find((b) => b.geoid === crossBlock.geoid)!;
    expect(cross).toBeDefined();
    expect(tr.passes[0]!.walkLow.includes(tr.order[crossing]!)).toBe(joins);
    const finalSet = Object.assign({}, ...c.steps.map((s) => s.set ?? {})) as Record<string, string>;
    expect(finalSet[cross.id]).toBe(joins ? 'low' : 'high');
    expect(c.steps.map((s) => s.caption).join(' ')).toContain(joins ? 'joins the first side' : 'starts the second side');
  }, SLOW);

  it.skipIf(!haveCO)('cut.order lists blocks in the trace\'s walk order', async () => {
    const c = await cutOrderCase(ctx);
    shape(c);
    const tr = (await cutTrace(ctx, 'CO', 3)).traces[0]!;
    const t = await cutTrace(ctx, 'CO', 3);
    const rank = new Map<string, number>();
    tr.order.forEach((b, i) => rank.set(t.blocks[b]!.geoid, i));
    const blocks = c.blocks!;
    expect(blocks.length).toBe(20);
    const ranks = blocks.map((b) => rank.get(b.geoid)!);
    for (let i = 1; i < ranks.length; i++) expect(ranks[i]!).toBeGreaterThan(ranks[i - 1]!);
    // The points end on the number line left to right in that same order.
    const xs = blocks.map((_, i) => lastTween(c, `p${i}`)![0]![0]);
    for (let i = 1; i < xs.length; i++) expect(xs[i]!).toBeGreaterThan(xs[i - 1]!);
  }, SLOW);

  it.skipIf(!haveCO)('cut.measure total equals the traced candidate\'s lengthM to the meter', async () => {
    const c = await cutMeasureCase(ctx);
    shape(c);
    const t = await cutTrace(ctx, 'CO', 3);
    const tr = t.traces[0]!;
    const edges = borderEdges(t, tr);
    const total = edges.reduce((s, e) => s + e.lengthM, 0);
    expect(Math.round(total)).toBe(Math.round(tr.lengthM));
    expect(numberIn(label(c, 'total'))).toBe(Math.round(tr.lengthM));
    // Running totals shown in the window never fall and never pass the whole border.
    const sums = (c.labels ?? []).filter((l) => l.id.startsWith('sum')).map((l) => numberIn(l.text));
    expect(sums.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < sums.length; i++) expect(sums[i]!).toBeGreaterThanOrEqual(sums[i - 1]!);
    expect(sums.at(-1)!).toBeLessThanOrEqual(Math.round(tr.lengthM));
    expect(c.steps.at(-1)!.caption).toContain('Water inside the state counts as part of the state');
  }, SLOW);

  it.skipIf(!(haveAL && land))('cut.both-ways shows two lengths that match candidates.json for AL cut 1 and keeps the shorter', async () => {
    const c = await cutBothWaysCase(ctx);
    shape(c);
    const out = await ctx.state('AL');
    const cut = out.cutStats.cuts[0]!;
    const k = Math.round(cut.angleDeg / out.metrics.angleStepDeg);
    const f = out.candidates.fields;
    const len = (low: number) => out.candidates.cuts[0]!.find((r) => r[f.indexOf('k')] === k && r[f.indexOf('lowSeats')] === low)![f.indexOf('lengthM')]!;
    expect(numberIn(label(c, 'len3'))).toBe(len(3));
    expect(numberIn(label(c, 'len4'))).toBe(len(4));
    const shorter = len(3) <= len(4) ? 3 : 4;
    const last = c.steps.at(-1)!;
    const finalSet = Object.assign({}, ...c.steps.map((s) => s.set ?? {})) as Record<string, string>;
    expect(finalSet[`line${shorter}`]).toBe('kept');
    expect(last.caption).toContain(`${shorter} seats`);
  }, SLOW);

  it.skipIf(!(haveCO && land))('cut.globe starts visibly bowed and ends with the line straight', async () => {
    const c = await cutGlobeCase(ctx);
    shape(c);
    const start = c.lines!.find((l) => l.id === 'cut')!.pts;
    const end = lastTween(c, 'cut')!;
    expect(end.length).toBe(start.length);
    // The plain grid must show a real bend (not a no-op tween), and the projection must remove it.
    expect(bow(start)).toBeGreaterThanOrEqual(8);
    expect(bow(end)).toBeLessThanOrEqual(0.5);
    const outline = c.lines!.find((l) => l.id === 'outline')!;
    expect(outline.pts.length).toBeLessThan(150);
    expect(lastTween(c, 'outline')!.length).toBe(outline.pts.length);
  }, SLOW);

  it.skipIf(!haveCO)('the copied walk key agrees with the generator and fails loudly when it does not', async () => {
    const t = await cutTrace(ctx, 'CO', 3);
    const order = t.traces[0]!.order;
    expect(walkTies(t, order)).toBe(0);
    const shuffled = Int32Array.from(order);
    [shuffled[100], shuffled[5000]] = [shuffled[5000]!, shuffled[100]!];
    expect(() => walkTies(t, shuffled)).toThrow(DataError);
    expect(() => walkTies(t, Int32Array.from(order).reverse())).toThrow(DataError);
  }, SLOW);

  it('registers the five cases', () => {
    expect(cutCases.length).toBe(5);
  });
});

describe('committed rule-examples.json carries the one-cut panels', () => {
  const file = RuleExamplesSchema.parse(JSON.parse(readFileSync('public/data/how/rule-examples.json', 'utf8')));
  it('has every stage 2 block case with blocks or lines', () => {
    for (const id of ['cut.order', 'cut.measure', 'cut.walk-stop', 'cut.both-ways', 'cut.globe']) {
      const c = file.cases.find((x) => x.id === id);
      expect(c, id).toBeDefined();
      expect((c!.blocks?.length ?? 0) + (c!.lines?.length ?? 0)).toBeGreaterThan(0);
    }
  });
});
