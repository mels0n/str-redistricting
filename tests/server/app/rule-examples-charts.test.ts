import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  chartCases, furthestCase, furthestOf, orderOfChecksCase, shortestTwo, stopCase, tieRule, tiesCase,
} from '../../../src/server/app/rule-examples/cases/charts.js';
import { cutTrace } from '../../../src/server/app/rule-examples/cases/trace.js';
import { createExtractContext, RuleCaseSchema, type RuleCase } from '../../../src/server/features/rule-examples/index.js';
import { parseRuleExamplesConfig } from '../../../src/server/shared/config/index.js';

// These read the generated plans (out/) and, for the tie, the cached census files; without them they skip.
const ctx = createExtractContext(parseRuleExamplesConfig([]));
const haveMS = existsSync('out/MS/candidates.json') && existsSync('out/MS/cut-stats.json');
const haveCO = existsSync('out/CO/balance.json') && existsSync('out/CO/metrics.json');
const haveHI = existsSync('out/HI/balance.json');
const haveTie = existsSync('out/NJ/candidates.json') && existsSync('data/raw/tl_2020_34_tabblock20.zip');
const SLOW = 300_000;
const whole = (n: number): string => n.toLocaleString('en-US');

const shape = (c: RuleCase): void => {
  RuleCaseSchema.parse(c);
  expect(c.stateName.length).toBeGreaterThan(2);
  expect(c.steps.length).toBeGreaterThanOrEqual(3);
  expect(c.steps.length).toBeLessThanOrEqual(7);
  const text = [...c.steps.map((s) => s.caption), ...(c.labels ?? []).map((l) => l.text), ...(c.chart?.labels ?? [])].join('\n');
  expect(text).not.toContain('—');
  const ids = [...(c.blocks ?? []), ...(c.lines ?? []), ...(c.labels ?? [])].map((x) => x.id);
  expect(new Set(ids).size).toBe(ids.length);
  const marks = Object.keys(c.chart?.marks ?? {}).map((m) => `chart-${m}`);
  const known = new Set([...ids, 'chart', 'chart-sorted', ...marks]);
  for (const s of c.steps) for (const id of [...s.show, ...(s.hide ?? [])]) expect(known).toContain(id);
};

const json = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8').replace(/^﻿/, '')) as T;
interface Cands { fields: string[]; cuts: number[][][] }
interface Stats { cuts: { angleDeg: number; lengthM: number; skipped: number; seats: number }[] }
const col = (c: Cands, f: string): number => c.fields.indexOf(f);

describe('tieRule', () => {
  it('orders by closeness to north-south, then smaller angle, then fewer first-side seats', () => {
    // 1,800 directions: k=0 and k=1800 are both north-south.
    expect(tieRule({ k: 187, lowSeats: 2 }, { k: 188, lowSeats: 2 }, 1800)).toEqual({ first: 'a', rule: 1 });
    expect(tieRule({ k: 1433, lowSeats: 1 }, { k: 1434, lowSeats: 1 }, 1800)).toEqual({ first: 'b', rule: 1 });
    // 0.1 degrees and 179.9 degrees lean equally from north-south: the smaller angle goes first.
    expect(tieRule({ k: 1799, lowSeats: 1 }, { k: 1, lowSeats: 1 }, 1800)).toEqual({ first: 'b', rule: 2 });
    // Same direction, two ways of splitting the seats: the first side with fewer seats goes first.
    expect(tieRule({ k: 300, lowSeats: 3 }, { k: 300, lowSeats: 2 }, 1800)).toEqual({ first: 'b', rule: 3 });
  });
});

describe('shortestTwo', () => {
  const fields = ['k', 'lowSeats', 'lengthM', 'unresolved'];
  it('takes the two shortest resolved candidates in the generator order and ignores unresolved ones', () => {
    const rows = [[5, 1, 100, 0], [6, 1, 90, 1], [7, 1, 100, 0], [1790, 1, 100, 0], [9, 1, 120, 0]];
    const [a, b] = shortestTwo(rows, fields, 1800)!;
    expect([a.k, b.k]).toEqual([5, 7]);
    expect(b.lengthM - a.lengthM).toBe(0);
  });
  it('is undefined when fewer than two candidates are resolved', () => {
    expect(shortestTwo([[1, 1, 5, 0], [2, 1, 6, 1]], fields, 1800)).toBeUndefined();
  });
});

describe('furthestOf', () => {
  it('picks the largest distance whichever side it is on, the lower number on an exact tie', () => {
    expect(furthestOf([-91.25, -175.25, 11.75, 185.75])).toBe(3);
    expect(furthestOf([35.5, -35.5])).toBe(0);
    expect(furthestOf([-35.5, 35.5])).toBe(0);
    expect(furthestOf([1, -9, 9, 2])).toBe(1);
  });
});

describe('cut.order-of-checks (MS cut 1)', () => {
  it.skipIf(!haveMS)('draws every direction in angle order; the winner is the shortest resolved line and equals cut-stats', async () => {
    const c = await orderOfChecksCase(ctx);
    shape(c);
    expect(c.id).toBe('cut.order-of-checks');
    expect(c.chart!.kind).toBe('strip');
    const cands = json<Cands>('out/MS/candidates.json');
    const stats = json<Stats>('out/MS/cut-stats.json');
    const rows = cands.cuts[0]!;
    const cut = stats.cuts[0]!;
    expect(c.chart!.values).toHaveLength(1800);
    const km = (r: number[]): number => r[col(cands, 'lengthM')]! / 1000;
    for (const r of rows) expect(c.chart!.values[r[col(cands, 'k')]!]).toBeCloseTo(km(r), 6);
    const { unresolved, skipped, winner } = c.chart!.marks!;
    expect(unresolved).toEqual(rows.filter((r) => r[col(cands, 'unresolved')] === 1).map((r) => r[col(cands, 'k')]!).sort((x, y) => x - y));
    // The winner is the shortest resolved line, at the length cut-stats.json records.
    const resolved = rows.filter((r) => r[col(cands, 'unresolved')] === 0);
    const shortest = resolved.reduce((m, r) => (r[col(cands, 'lengthM')]! < m[col(cands, 'lengthM')]! ? r : m));
    expect(winner).toEqual([shortest[col(cands, 'k')]!]);
    expect(shortest[col(cands, 'lengthM')]).toBe(cut.lengthM);
    expect(shortest[col(cands, 'k')]! / 10).toBe(cut.angleDeg);
    expect(c.chart!.values[winner![0]!]).toBeCloseTo(cut.lengthM / 1000, 6);
    // The lines skipped are exactly the unresolved ones shorter than the winner, as many as cut-stats counts.
    expect(skipped).toHaveLength(cut.skipped);
    for (const k of skipped!) {
      expect(unresolved).toContain(k);
      expect(c.chart!.values[k]!).toBeLessThan(c.chart!.values[winner![0]!]!);
    }
    expect(c.link).toEqual({ state: 'MS', cut: 1 });
    const text = c.steps.map((s) => s.caption).join(' ');
    expect(text).toContain(whole(unresolved!.length));
    expect(text).toContain(whole(cut.lengthM));
    // The steps show the chart, then the unresolved marks, then the sort, then the skipped line, then the winner.
    const shows = c.steps.map((s) => s.show.filter((id) => id.startsWith('chart')));
    expect(shows[0]).toEqual(['chart']);
    expect(shows.some((s) => s.includes('chart-unresolved'))).toBe(true);
    expect(shows.some((s) => s.includes('chart-sorted'))).toBe(true);
    expect(shows.at(-1)).toContain('chart-winner');
  });
});

describe('cut.ties', () => {
  it.skipIf(!haveTie)('is a true tie settled by the documented order, or says it is not a tie', async () => {
    const c = await tiesCase(ctx);
    shape(c);
    expect(c.id).toBe('cut.ties');
    expect(c.chart!.kind).toBe('bars');
    const text = c.steps.map((s) => s.caption).join(' ');
    const [a, b] = c.chart!.values;
    const tied = Math.round(a! * 100) === Math.round(b! * 100);
    if (!tied) {
      expect(text).toContain('Not a tie');
      return;
    }
    // A true tie: the two lines agree to the centimeter and the cut took the one the documented order puts first.
    const t = await cutTrace(ctx, c.state, c.source.cut!);
    const pair = [...t.result.candidateStats].filter((s) => Math.round(s.lengthM * 100) === Math.round(t.result.lengthM * 100));
    expect(pair.length).toBeGreaterThanOrEqual(2);
    const order = pair.sort((x, y) => {
      const r = tieRule({ k: x.k, lowSeats: x.lowSeats }, { k: y.k, lowSeats: y.lowSeats }, t.out.metrics.angleCount as number);
      return r.first === 'a' ? -1 : 1;
    });
    expect((order[0]!.k * 180) / (t.out.metrics.angleCount as number)).toBe(t.cut.angleDeg);
    expect(c.chart!.labels![0]).toBe(`${t.cut.angleDeg}°`);
    expect(c.chart!.marks!.winner).toEqual([0]);
    expect(text).toContain('tied');
    expect(text).toContain(whole(Math.round(a! * 100)));
    expect(c.source.angleDeg).toBe(t.cut.angleDeg);
  }, SLOW);
});

describe('balance.furthest (CO)', () => {
  it.skipIf(!(haveCO && haveHI))('bars are each district before balancing minus the ideal; the furthest is marked', async () => {
    const c = await furthestCase(ctx);
    shape(c);
    expect(c.chart!.kind).toBe('bars');
    const b = json<{ before: number[]; moves: { from: number; to: number }[] }>('out/CO/balance.json');
    const m = json<{ ideal: number }>('out/CO/metrics.json');
    expect(c.chart!.values).toEqual(b.before.map((p) => p - m.ideal));
    expect(c.chart!.labels).toEqual(b.before.map((_, i) => String(i + 1)));
    const worst = c.chart!.values.reduce((w, v, i, all) => (Math.abs(v) > Math.abs(all[w]!) ? i : w), 0);
    expect(c.chart!.marks!.furthest).toEqual([worst]);
    // The first move touches that district, as the rule says it starts there.
    expect([b.moves[0]!.from, b.moves[0]!.to]).toContain(worst + 1);
    const text = c.steps.map((s) => s.caption).join(' ');
    expect(text).toContain(`District ${worst + 1}`);
    expect(text).toContain('Hawaii');
    // The tie example is real: Hawaii's two districts are exactly as far from its ideal.
    const hi = json<{ before: number[] }>('out/HI/balance.json');
    const hm = json<{ ideal: number }>('out/HI/metrics.json');
    expect(Math.abs(hi.before[0]! - hm.ideal)).toBe(Math.abs(hi.before[1]! - hm.ideal));
  });
});

describe('balance.stop (CO)', () => {
  it.skipIf(!haveCO)('starts at the sum of squares before the first move and falls by each move\'s gain to the final plan', async () => {
    const c = await stopCase(ctx);
    shape(c);
    expect(c.chart!.kind).toBe('series');
    const b = json<{ before: number[]; moves: { gain: number }[] }>('out/CO/balance.json');
    const m = json<{ ideal: number; districts: { pop: number }[]; rangeBeforeBalancing: number; rangeAfterBalancing: number }>('out/CO/metrics.json');
    const sq = (pops: number[]): number => pops.reduce((s, p) => s + (p - m.ideal) * (p - m.ideal), 0);
    const v = c.chart!.values;
    expect(v).toHaveLength(b.moves.length + 1);
    expect(b.moves).toHaveLength(20);
    expect(v[0]).toBe(sq(b.before));
    b.moves.forEach((mv, i) => expect(v[i]! - v[i + 1]!).toBe(mv.gain));
    expect(v.at(-1)).toBe(sq(m.districts.map((d) => d.pop)));
    for (let i = 1; i < v.length; i++) expect(v[i]!).toBeLessThan(v[i - 1]!);
    const pops = m.districts.map((d) => d.pop);
    expect(Math.max(...pops) - Math.min(...pops)).toBe(m.rangeAfterBalancing);
    expect(Math.max(...b.before) - Math.min(...b.before)).toBe(m.rangeBeforeBalancing);
    const text = c.steps.map((s) => s.caption).join(' ');
    expect(text).toContain(whole(m.rangeAfterBalancing));
    expect(text).toContain(whole(m.rangeBeforeBalancing));
    expect(text).toContain('20 moves');
    expect(c.chart!.marks!.first).toEqual([0]);
    expect(c.chart!.marks!.last).toEqual([20]);
  });
});

describe('chart cases together', () => {
  it('are four builders, one id each', () => {
    expect(chartCases).toHaveLength(4);
  });
});
