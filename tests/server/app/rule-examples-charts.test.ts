import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  chartCases, furthestCase, furthestOf, gapUm, gapWords, orderOfChecksCase, shortestTwo, stopCase, tieRuleText, tiesCase,
  type Cand,
} from '../../../src/server/app/rule-examples/cases/charts.js';
import { createExtractContext, RuleCaseSchema, type RuleCase } from '../../../src/server/features/rule-examples/index.js';
import { parseRuleExamplesConfig } from '../../../src/server/shared/config/index.js';

// These read the generated plans (out/) and, for the tie, the cached census files; without them they skip.
const ctx = createExtractContext(parseRuleExamplesConfig([]));
const haveOrder = existsSync('out/MS/candidates.json') && existsSync('out/MS/cut-stats.json');
const haveCO = existsSync('out/CO/balance.json') && existsSync('out/CO/metrics.json');
const haveHI = existsSync('out/HI/balance.json');
const haveTie = existsSync('out/NJ/candidates.json') && existsSync('data/raw/tl_2020_34_tabblock20.zip');
const SLOW = 300_000;
// The captions say nothing about a fixed step size.
const STALE = [/1,800/, /0\.1°/, /every 0\.1/, /angle step/i];
const whole = (n: number): string => n.toLocaleString('en-US');

const shape = (c: RuleCase): void => {
  RuleCaseSchema.parse(c);
  expect(c.stateName.length).toBeGreaterThan(2);
  expect(c.steps.length).toBeGreaterThanOrEqual(3);
  expect(c.steps.length).toBeLessThanOrEqual(7);
  const text = [...c.steps.map((s) => s.caption), ...(c.labels ?? []).map((l) => l.text), ...(c.chart?.labels ?? [])].join('\n');
  expect(text).not.toContain('—');
  for (const re of STALE) expect(text).not.toMatch(re);
  const ids = [...(c.blocks ?? []), ...(c.lines ?? []), ...(c.labels ?? [])].map((x) => x.id);
  expect(new Set(ids).size).toBe(ids.length);
  const marks = Object.keys(c.chart?.marks ?? {}).map((m) => `chart-${m}`);
  const known = new Set([...ids, 'chart', 'chart-sorted', ...marks]);
  for (const s of c.steps) for (const id of [...s.show, ...(s.hide ?? [])]) expect(known).toContain(id);
};

const json = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8').replace(/^﻿/, '')) as T;
interface Cands { fields: string[]; cuts: number[][][] }
interface Stats { cuts: { angleDeg: number; fromDeg: number; toDeg: number; lengthM: number; skipped: number; seats: number; candidateRanges: number }[] }
const col = (c: Cands, f: string): number => c.fields.indexOf(f);

const cand = (fromDeg: number, toDeg: number, nearestNorthSouthDeg: number, lowSeats = 1): Cand => ({ lowSeats, fromDeg, toDeg, nearestNorthSouthDeg, lengthM: 100 });

describe('tieRuleText', () => {
  it('names the rule that decides between two equally long candidates', () => {
    expect(tieRuleText(cand(10, 11, 10), cand(12, 13, 12), 1)).toContain('nearer north-south');
    expect(tieRuleText(cand(10, 11, 10), cand(12, 13, 12), 1)).toContain('10° to 11° goes first');
    expect(tieRuleText(cand(170, 171, 170), cand(10, 11, 10), 2)).toContain('starts earlier');
    expect(tieRuleText(cand(10, 11, 10, 2), cand(10, 11, 10, 3), 3)).toContain('fewer seats');
    // Distance from north-south is the smaller of the angle and its supplement.
    expect(tieRuleText(cand(170, 171, 171), cand(12, 13, 12), 1)).toContain('within 9°');
  });
});

describe('shortestTwo', () => {
  const fields = ['lowSeats', 'fromDeg', 'toDeg', 'nearestNorthSouthDeg', 'lengthM', 'lowPop'];
  it('takes the first two rows in the generator order', () => {
    const rows = [[1, 5, 6, 5, 100, 0], [1, 7, 8, 7, 100.000001, 0], [1, 9, 10, 9, 120, 0]];
    const [a, b] = shortestTwo(rows, fields)!;
    expect([a.fromDeg, b.fromDeg]).toEqual([5, 7]);
    expect(gapUm(a.lengthM, b.lengthM)).toBe(1);
  });
  it('is undefined with fewer than two rows and refuses rows out of order', () => {
    expect(shortestTwo([[1, 1, 2, 1, 5, 0]], fields)).toBeUndefined();
    expect(() => shortestTwo([[1, 1, 2, 1, 6, 0], [1, 3, 4, 3, 5, 0]], fields)).toThrow();
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

describe('cut.order-of-checks', () => {
  it.skipIf(!haveOrder)('draws the leading ranges by direction, sorts them by length, and ends on the cut in cut-stats', async () => {
    const c = await orderOfChecksCase(ctx);
    shape(c);
    expect(c.id).toBe('cut.order-of-checks');
    expect(c.chart!.kind).toBe('strip');
    const cands = json<Cands>(`out/${c.state}/candidates.json`);
    const stats = json<Stats>(`out/${c.state}/cut-stats.json`);
    const rows = cands.cuts[c.source.cut! - 1]!;
    const cut = stats.cuts[c.source.cut! - 1]!;
    expect(c.chart!.values).toHaveLength(rows.length);
    const lens = rows.map((r) => r[col(cands, 'lengthM')]! / 1000);
    expect([...c.chart!.values].sort((x, y) => x - y)).toEqual([...lens].sort((x, y) => x - y));
    // The winner is the first row in the generator's order, the shortest of the leading ranges, and is the cut on disk.
    const [winner] = c.chart!.marks!.winner!;
    expect(c.chart!.values[winner!]).toBeCloseTo(lens[0]!, 9);
    expect(Math.min(...c.chart!.values)).toBeCloseTo(lens[0]!, 9);
    expect(rows[0]![col(cands, 'fromDeg')]).toBe(cut.fromDeg);
    expect(rows[0]![col(cands, 'toDeg')]).toBe(cut.toDeg);
    expect(cut.skipped).toBeGreaterThanOrEqual(1);
    expect(c.link).toEqual({ state: c.state, cut: c.source.cut });
    const text = c.steps.map((s) => s.caption).join(' ');
    expect(text).toContain(whole(cut.candidateRanges));
    expect(text).toContain(whole(Math.round(cut.lengthM)));
    expect(text).toContain('every straight line');
    expect(text).toContain('Each range is checked once');
    expect(c.steps[1]!.caption.indexOf('settled')).toBeLessThan(c.steps[1]!.caption.indexOf('measured'));
    expect(c.steps[2]!.show).toContain('chart-sorted');
    expect(c.steps.at(-1)!.show).toContain('chart-winner');
    expect(c.steps[0]!.show).not.toContain('chart-sorted');
  });
});

describe('gapWords', () => {
  it('says a gap in meters, centimeters or millimeters, and floors the tiniest', () => {
    expect(gapWords(12.345)).toBe('12.35 m');
    expect(gapWords(0.0907)).toBe('9.1 cm');
    expect(gapWords(0.0004)).toBe('0.40 mm');
    expect(gapWords(1e-9)).toBe('less than a thousandth of a millimeter');
  });
});

describe('cut.ties', () => {
  it.skipIf(!haveTie)('shows the closest call with exact lengths, and says honestly whether it is a tie', async () => {
    const c = await tiesCase(ctx);
    shape(c);
    expect(c.id).toBe('cut.ties');
    expect(c.chart!.kind).toBe('bars');
    const text = c.steps.map((s) => s.caption).join(' ');
    const cands = json<Cands>(`out/${c.state}/candidates.json`);
    const rows = cands.cuts[c.source.cut! - 1]!;
    const [x, y] = [rows[0]![col(cands, 'lengthM')]!, rows[1]![col(cands, 'lengthM')]!];
    expect(c.chart!.values).toEqual([Math.round(x * 100) / 100, Math.round(y * 100) / 100]);
    expect(c.chart!.marks!.winner).toEqual([0]);
    expect(text).toContain('to the micrometer');
    if (gapUm(x, y) === 0) {
      expect(text).toContain('exactly the same length');
      expect(c.chart!.marks!.tied).toEqual([0, 1]);
    } else {
      expect(text).toContain('Not a tie');
      expect(text).toContain('Had they been exactly equal');
      expect(c.chart!.marks!.close).toEqual([0, 1]);
    }
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
    expect(b.moves).toHaveLength(json<{ balanceMoves: number }>('out/CO/metrics.json').balanceMoves);
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
    expect(text).toContain(`${b.moves.length} moves`);
    expect(c.chart!.marks!.first).toEqual([0]);
    expect(c.chart!.marks!.last).toEqual([20]);
  });
});

describe('chart cases together', () => {
  it('are four builders, one id each', () => {
    expect(chartCases).toHaveLength(4);
  });
});
