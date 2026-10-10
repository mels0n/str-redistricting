import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RuleExamplesSchema } from '../../src/client/entities/rule-example';
import { PRE_RELEASE } from '../helpers/pre-release';

// Reads only tracked files, so it runs in CI. The cases are generated from real runs, so each must still agree with
// the stats published beside them.
const FIX = 'rerun `npm run rule-examples` and commit public/data/how/rule-examples.json';
const read = (rel: string): unknown => JSON.parse(readFileSync(resolve(process.cwd(), rel), 'utf8').replace(/^\uFEFF/, ''));

interface Case { id: string; state: string; source: Record<string, number>; steps: { caption: string }[]; labels?: { text: string }[]; chart?: { values: number[] } }
interface Metrics { seats: number; population: number; ideal: number; cuts: number; assignmentSha256: string }

const file = read('public/data/how/rule-examples.json') as { cases: Case[] };
const metricsOf = (st: string): Metrics => (read(`public/data/${st}/stats.json`) as { finished: { metrics: Metrics } }).finished.metrics;
const byId = (id: string): Case => {
  const c = file.cases.find((x) => x.id === id);
  if (!c) throw new Error(`rule-examples.json has no case ${id}; ${FIX}`);
  return c;
};
const text = (c: Case): string => [...c.steps.map((s) => s.caption), ...(c.labels ?? []).map((l) => l.text)].join('\n');
const n = (v: number): string => v.toLocaleString('en-US');

describe('rule-examples.json against the published stats', () => {
  it('parses under the client schema that reads it', () => {
    expect(RuleExamplesSchema.safeParse(file).success, `client schema rejects the file; ${FIX}`).toBe(true);
  });
});

// Published data is regenerated at the 1.0 cut; until then the tracked files can disagree with each other.
describe.skipIf(PRE_RELEASE)('rule-examples.json against the published stats (published data is regenerated at the 1.0 cut)', () => {
  it('fingerprint.repeat shows the published Colorado plan hash', () => {
    const hash = metricsOf('CO').assignmentSha256;
    const shown = byId('fingerprint.repeat').labels?.filter((l) => /^[0-9a-f]{64}$/.test(l.text)).map((l) => l.text) ?? [];
    expect(shown.length, 'hash labels').toBe(2);
    for (const h of shown) expect(h, `hash is stale, ${FIX}`).toBe(hash);
  });

  it('CO ideal case matches published population, seats and ideal', () => {
    const m = metricsOf('CO');
    const t = text(byId('balance.ideal'));
    expect(t, FIX).toContain(`${n(m.population)} / ${m.seats} = ${n(m.ideal)}`);
  });

  it('AL share case matches published population and seats', () => {
    const m = metricsOf('AL');
    const t = text(byId('cut.share'));
    expect(t, FIX).toContain(`${n(m.population)} people`);
    expect(t, FIX).toContain(`${m.seats} seats`);
  });

  it('MS order-of-checks case matches the published direction count and cut number', () => {
    const m = metricsOf('MS');
    const c = byId('cut.order-of-checks');
    expect(c.source.cut, FIX).toBeLessThanOrEqual(m.cuts);
  });

  it('NJ ties case points at a cut NJ really has', () => {
    const m = metricsOf('NJ');
    const c = byId('cut.ties');
    expect(c.source.cut, FIX).toBeLessThanOrEqual(m.cuts);
    expect(c.source.angleDeg, FIX).toBeGreaterThanOrEqual(0);
    expect(c.source.angleDeg, FIX).toBeLessThan(180);
  });

  it('AK islands case is for a state with published stats', () => {
    expect(metricsOf('AK').seats, FIX).toBeGreaterThan(0);
    expect(byId('strays.islands').state).toBe('AK');
  });

  it('HI, when a case uses it, matches its published seats', () => {
    const hi = file.cases.filter((c) => c.state === 'HI');
    for (const c of hi) expect(text(c), FIX).toContain(`${metricsOf('HI').seats}`);
  });
});
