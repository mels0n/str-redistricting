import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { allowedCase, balanceCases, nextFurthestCase, scoreCase } from '../../../src/server/app/rule-examples/cases/balance.js';
import { balance, type BalanceRound } from '../../../src/server/features/balance/index.js';
import { createExtractContext, RuleCaseSchema, type RuleCase } from '../../../src/server/features/rule-examples/index.js';
import { parseRuleExamplesConfig } from '../../../src/server/shared/config/index.js';

// These read the generated plans (out/) and the cached census files (data/raw/); without them they skip.
const ctx = createExtractContext(parseRuleExamplesConfig([]));
const haveCO = existsSync('out/CO/balance.json') && existsSync('out/CO/before-balancing/assignment.csv') && existsSync('data/raw/tl_2020_08_tabblock20.zip');
const SLOW = 300_000;
const whole = (n: number): string => n.toLocaleString('en-US');
const people = (n: number): string => (Number.isInteger(n) ? whole(n) : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

const shape = (c: RuleCase): void => {
  RuleCaseSchema.parse(c);
  expect(c.stateName).toBe('Colorado');
  expect(c.steps.length).toBeGreaterThanOrEqual(3);
  expect(c.steps.length).toBeLessThanOrEqual(7);
  const text = [...c.steps.map((s) => s.caption), ...(c.labels ?? []).map((l) => l.text), ...(c.chart?.labels ?? [])].join('\n');
  expect(text).not.toContain('—');
  expect(text).not.toMatch(/neighbour|colour/);
  const ids = [...(c.blocks ?? []), ...(c.lines ?? []), ...(c.labels ?? [])].map((x) => x.id);
  expect(new Set(ids).size).toBe(ids.length);
  const marks = Object.keys(c.chart?.marks ?? {}).map((m) => `chart-${m}`);
  const known = new Set([...ids, 'chart', ...marks]);
  for (const s of c.steps) for (const id of [...s.show, ...(s.hide ?? []), ...Object.keys(s.set ?? {})]) expect(known).toContain(id);
};

/** What a step changes on screen: shapes shown or hidden, and states set to a new value. */
function changesAt(c: RuleCase, i: number): string[] {
  const prev = new Set(i > 0 ? c.steps[i - 1]!.show : []);
  const now = new Set(c.steps[i]!.show);
  const before: Record<string, string> = Object.assign({}, ...c.steps.slice(0, i).map((s) => s.set ?? {})) as Record<string, string>;
  const out = [...now].filter((id) => !prev.has(id)).concat([...prev].filter((id) => !now.has(id)));
  for (const [id, v] of Object.entries(c.steps[i]!.set ?? {})) if (before[id] !== v) out.push(id);
  return out;
}
/** Ids whose state a step sets to `value` for the first time. */
const newlySet = (c: RuleCase, i: number, value: string): string[] =>
  Object.entries(c.steps[i]!.set ?? {}).filter(([id, v]) => v === value && !c.steps.slice(0, i).some((s) => s.set?.[id] === value)).map(([id]) => id);

const json = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8').replace(/^﻿/, '')) as T;
interface Log { before: number[]; moves: { block: number; geoid: string; from: number; to: number; pop: number; gain: number }[] }

/** The generator's own rounds for Colorado, re-run here from the plan before balancing. */
async function rounds(): Promise<{ rounds: BalanceRound[]; geoids: string[] }> {
  const [out, sb] = await Promise.all([ctx.state('CO'), ctx.blocks('CO')]);
  const input = Int32Array.from(sb.blocks, (b) => out.before.get(b.geoid)! - 1);
  const rs: BalanceRound[] = [];
  balance(sb.blocks, sb.topo, input, out.balance.before.length, { onRound: (r) => rs.push(r) });
  return { rounds: rs, geoids: sb.blocks.map((b) => b.geoid) };
}

describe('balancing move panels (CO)', () => {
  it.skipIf(!haveCO)('score case shows 2 × 74 × (a − b − 74) = 14,800', async () => {
    const c = await scoreCase(ctx);
    shape(c);
    const log = json<Log>('out/CO/balance.json');
    const { ideal } = json<{ ideal: number }>('out/CO/metrics.json');
    const m = log.moves[0]!;
    expect(m).toMatchObject({ geoid: '080470138012029', pop: 74, from: 4, to: 3, gain: 14800 });
    const a = log.before[m.from - 1]! - ideal, b = log.before[m.to - 1]! - ideal;
    expect(2 * 74 * (a - b - 74)).toBe(14800);
    const text = c.steps.map((s) => s.caption).join('\n');
    expect(text).toContain(`2 × 74 × (${people(a)} − ${people(b)} − 74) = 14,800`);
    expect(text).toContain(`${people(a)} over`);
    // The block is drawn in District 4, and a copy in District 3 appears only when the move is made.
    const orig = c.blocks!.filter((x) => x.geoid === m.geoid);
    expect(orig.map((x) => x.district).sort()).toEqual([3, 4]);
    const copy = orig.find((x) => x.district === 3)!;
    const last = c.steps.length - 1;
    expect(c.steps.slice(0, last).some((s) => s.show.includes(copy.id))).toBe(false);
    expect(c.steps[last]!.show).toContain(copy.id);
    // The populations after the move are the before figures with 74 people moved.
    const labels = (c.labels ?? []).map((l) => l.text).join('\n');
    expect(labels).toContain(whole(log.before[3]! - 74));
    expect(labels).toContain(whole(log.before[2]! + 74));
    expect(c.blocks!.length).toBeLessThanOrEqual(25);
    expect(c.source.move).toBe(1);
    for (let i = 1; i < c.steps.length; i++) expect(changesAt(c, i).length, `step ${i + 1}`).toBeGreaterThan(0);
  }, SLOW);

  it.skipIf(!haveCO)('score case ranks a real tie by GEOID, as the generator did', async () => {
    const c = await scoreCase(ctx);
    const { rounds: rs, geoids } = await rounds();
    const shown = new Set(c.blocks!.map((b) => b.geoid));
    const ranked = rs[0]!.candidates.filter((x) => x.allowed && shown.has(geoids[x.block]!));
    // The generator's order: best score first, then GEOID.
    for (let i = 1; i < ranked.length; i++) {
      const p = ranked[i - 1]!, q = ranked[i]!;
      expect(p.gain > q.gain || (p.gain === q.gain && geoids[p.block]! < geoids[q.block]!)).toBe(true);
    }
    const tie = ranked.find((x, i) => ranked.some((y, j) => j !== i && y.gain === x.gain));
    if (tie) expect(c.steps.map((s) => s.caption).join('\n')).toContain(`${whole(tie.gain)}`);
  }, SLOW);

  it.skipIf(!haveCO)('every greyed block carries the reason the hook reported', async () => {
    const c = await allowedCase(ctx);
    shape(c);
    const { rounds: rs, geoids } = await rounds();
    const first = rs[0]!;
    const byGeoid = new Map<string, BalanceRound['candidates'][number][]>();
    for (const x of first.candidates) {
      const g = geoids[x.block]!;
      byGeoid.set(g, [...(byGeoid.get(g) ?? []), x]);
    }
    const geoidOf = new Map(c.blocks!.map((b) => [b.id, b.geoid] as const));
    const order: string[] = [];
    c.steps.forEach((s, i) => {
      const greyed = newlySet(c, i, 'out');
      if (!greyed.length) return;
      const reasons = new Set(greyed.flatMap((id) => byGeoid.get(geoidOf.get(id)!)!.map((x) => x.reason)));
      // One reason per step, and every move of every block greyed in it was refused for that reason.
      expect(reasons.size, s.caption).toBe(1);
      const [reason] = [...reasons];
      expect(reason).toBeDefined();
      order.push(reason!);
      expect(s.caption).toContain(`${greyed.length}`);
      expect(s.caption).toMatch({ 'no-people': /no people/, widens: /widen/, disconnects: /connected/ }[reason!]!);
    });
    expect(order).toEqual(['no-people', 'widens', 'disconnects']);
    // The blocks left lit are moves the hook allowed; together they cover every border block in the window.
    const hot = c.steps.flatMap((_, i) => newlySet(c, i, 'hot'));
    expect(hot.length).toBeGreaterThan(0);
    for (const id of hot) expect(byGeoid.get(geoidOf.get(id)!)!.every((x) => x.allowed)).toBe(true);
    const final: Record<string, string> = Object.assign({}, ...c.steps.map((s) => s.set ?? {})) as Record<string, string>;
    for (const b of c.blocks!) {
      if (byGeoid.has(b.geoid)) expect(['out', 'hot']).toContain(final[b.id]);
      else expect(final[b.id]).toBeUndefined();
    }
    expect(c.blocks!.length).toBeLessThanOrEqual(24);
    for (let i = 1; i < c.steps.length; i++) expect(changesAt(c, i).length, `step ${i + 1}`).toBeGreaterThan(0);
  }, SLOW);

  it.skipIf(!haveCO)("next-furthest case's first tried district had no allowed move", async () => {
    const c = await nextFurthestCase(ctx);
    shape(c);
    expect(c.missing).toBeUndefined();
    const { rounds: rs } = await rounds();
    const k = rs.findIndex((r) => r.tried.length > 1);
    expect(k).toBeGreaterThanOrEqual(0);
    const r = rs[k]!;
    expect(c.source.move).toBe(k + 1);
    const [f, next] = r.tried as [number, number];
    const mine = r.candidates.filter((x) => x.district === f);
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((x) => !x.allowed)).toBe(true);
    expect(c.chart!.marks!.furthest).toEqual([f]);
    expect(c.chart!.marks!.runnerUp).toEqual([f]);
    expect(c.chart!.marks!.winner).toEqual([next]);
    const log = json<Log>('out/CO/balance.json');
    expect([log.moves[k]!.from, log.moves[k]!.to]).toContain(next + 1);
    const text = c.steps.map((s) => s.caption).join('\n');
    expect(text).toContain(whole(mine.length));
    expect(text).toContain(`District ${f + 1}`);
    expect(text).toContain(`District ${next + 1}`);
    // The bars are each district's distance from the ideal just before that round's move, then before the next.
    const { ideal } = json<{ ideal: number }>('out/CO/metrics.json');
    const pops = [...log.before];
    for (const m of log.moves.slice(0, k)) { pops[m.from - 1]! -= m.pop; pops[m.to - 1]! += m.pop; }
    expect(c.chart!.values.slice(0, pops.length)).toEqual(pops.map((p) => p - ideal));
    for (let i = 1; i < c.steps.length; i++) expect(changesAt(c, i).length, `step ${i + 1}`).toBeGreaterThan(0);
  }, SLOW);

  it('registers the three balancing builders', () => {
    expect(balanceCases).toEqual([allowedCase, scoreCase, nextFurthestCase]);
  });
});
