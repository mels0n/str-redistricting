import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BalanceSchema, StatsSchema, balancePlanAt, isFastReplay, isPartway, populationsAfter, rangeOf, rangeTrace, type BalanceMove } from '../../src/client/entities/plan';
import { describeStep, planPressed } from '../../src/client/features/plan-options';

const data = (p: string): unknown => JSON.parse(readFileSync(new URL(`../../public/data/${p}`, import.meta.url), 'utf8'));
const mv = (order: number, from: number, to: number, pop: number): BalanceMove => ({ order, geoid: `0800000000000${order}`, from, to, pop, gain: 1 });

describe('which plan the balancing replay shows', () => {
  it('is the plan before balancing until the last move, which is the finished map', () => {
    expect(balancePlanAt(0, 22)).toBe('before');
    expect(balancePlanAt(21, 22)).toBe('before');
    expect(balancePlanAt(22, 22)).toBe('finished');
    expect(balancePlanAt(0, 0)).toBe('before');
  });
  it('is partway only between the first and the last move', () => {
    expect([0, 1, 21, 22].map((m) => isPartway(m, 22))).toEqual([false, true, true, false]);
  });
});

describe('the plan control during the replay', () => {
  it('presses the visitor’s plan when no replay is open', () => {
    expect(planPressed('finished', null)).toBe('finished');
    expect(planPressed('before', null)).toBe('before');
  });
  it('presses neither plan during the cuts and the replay, until the last move', () => {
    expect(planPressed('finished', { phase: 'cut', k: 3, total: 7 })).toBeNull();
    expect(planPressed('finished', { phase: 'balance', m: 0, total: 22 })).toBeNull();
    expect(planPressed('finished', { phase: 'balance', m: 21, total: 22 })).toBeNull();
    expect(planPressed('before', { phase: 'balance', m: 22, total: 22 })).toBe('finished');
  });
  it('names the step on screen', () => {
    expect(describeStep({ phase: 'cut', k: 3, total: 7 })).toMatch(/cut 3 of 7/);
    expect(describeStep({ phase: 'balance', m: 5, total: 22 })).toMatch(/move 5 of 22/);
    expect(describeStep({ phase: 'balance', m: 5, total: 22 })).toMatch(/Partway/);
    expect(describeStep({ phase: 'balance', m: 22, total: 22 })).toMatch(/ends on the finished map/);
    expect(describeStep({ phase: 'balance', m: 0, total: 22 })).toMatch(/before the first move/);
  });
});

describe('the range trace', () => {
  const moves = [mv(1, 2, 3, 50), mv(2, 2, 1, 5), mv(3, 1, 3, 4)];
  it('gives the state range before the first move and after each move', () => {
    const trace = rangeTrace([1000, 1060, 940], moves);
    expect(trace).toEqual([120, 20, 15, 11]);
    expect(trace).toEqual([0, 1, 2, 3].map((m) => rangeOf(populationsAfter([1000, 1060, 940], moves, m))));
  });
  it('starts and ends on the published range in every state', () => {
    for (const abbr of ['RI', 'CO', 'CA']) {
      const stats = StatsSchema.parse(data(`${abbr}/stats.json`));
      const log = BalanceSchema.parse(data(`${abbr}/balance.json`));
      const moves2 = [...log.moves].sort((a, b) => a.order - b.order);
      const trace = rangeTrace(log.before, moves2);
      expect(trace).toHaveLength(moves2.length + 1);
      expect(trace[0]).toBe(stats.finished.metrics.rangeBeforeBalancing);
      expect(trace.at(-1)).toBe(stats.finished.metrics.rangeAfterBalancing);
    }
  });
});

describe('long replays', () => {
  const pace = { baseMs: 1000, totalMs: 45000, minMs: 120 };
  it('are the ones that play faster than the normal step pace', () => {
    expect(isFastReplay(22, pace)).toBe(false);
    expect(isFastReplay(45, pace)).toBe(false);
    expect(isFastReplay(473, pace)).toBe(true);
  });
});
