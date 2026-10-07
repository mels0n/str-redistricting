import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { Block, BlockPolygons } from '../../../src/server/entities/census-block/index.js';
import {
  createExtractContext, dataCases, extractRuleExamples, MAX_BYTES, pieceMembers, projectWindow, RuleExamplesSchema, writeRuleExamples,
  type CaseBuilder, type ExtractContext, type RuleCase, type StateOutput,
} from '../../../src/server/features/rule-examples/index.js';
import { fingerprintCase, idealCase, shareCase } from '../../../src/server/features/rule-examples/cases/data.js';
import { parseRuleExamplesConfig } from '../../../src/server/shared/config/index.js';
import { DataError } from '../../../src/server/shared/errors/index.js';

const cfg = parseRuleExamplesConfig([]);
const ctx = createExtractContext(cfg);
const tmp = mkdtempSync(join(tmpdir(), 'rule-examples-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const haveAL = existsSync('out/AL/cut-stats.json') && existsSync('out/AL/metrics.json');
const haveCO = existsSync('out/CO/metrics.json') && existsSync('out/CO/balance.json');
const haveRepeat = haveCO && existsSync('out-repeat/CO/metrics.json');

const tiny = (id: string, caption = 'A caption.'): RuleCase => ({
  id, state: 'XX', stateName: 'Xland', source: {}, link: { state: 'XX' }, view: { w: 10, h: 10 }, steps: [{ caption, show: [] }],
});
const captions = (c: RuleCase): string[] => c.steps.map((s) => s.caption);

describe('rule-examples data cases', () => {
  it.skipIf(!haveAL)('cut.share for AL cut 1 (needs out/AL)', async () => {
    const c = await shareCase(ctx);
    const last = captions(c).at(-1)!;
    expect(last).toContain('5,024,279');
    expect(last).toContain('3');
    expect(last).toContain('7');
    expect(last).toContain('2,153,262.43');
    expect(c.link).toEqual({ state: 'AL', cut: 1 });
    expect(c.stateName).toBe('Alabama');
    expect(captions(c)[0]).toContain('Alabama has');
  });

  it.skipIf(!haveCO)('balance.ideal for CO (needs out/CO)', async () => {
    const text = captions(await idealCase(ctx)).join(' ');
    for (const s of ['5,773,714', '8', '721,714.25', '721,714', '721,715']) expect(text).toContain(s);
  });

  it.skipIf(!haveRepeat)('fingerprint.repeat hashes match both runs (needs out/CO and out-repeat/CO)', async () => {
    const c = await fingerprintCase(ctx);
    const sha = (dir: string) => (JSON.parse(readFileSync(`${dir}/CO/metrics.json`, 'utf8')) as { assignmentSha256: string }).assignmentSha256;
    expect(c.labels?.find((l) => l.id === 'hash-a')?.text).toBe(sha('out'));
    expect(c.labels?.find((l) => l.id === 'hash-b')?.text).toBe(sha('out-repeat'));
  });

  it.skipIf(!haveCO)('fingerprint.repeat is marked missing when the repeat run is absent (needs out/CO)', async () => {
    const c = await fingerprintCase({ ...ctx, repeatMetrics: async () => undefined, state: ctx.state });
    expect(c.missing).toBeTruthy();
    expect(c.steps.length).toBeGreaterThan(0);
  }, 30_000);

  it.skipIf(!(haveAL && haveRepeat))('no em dash in any caption or label (needs out/AL, out/CO, out-repeat/CO)', async () => {
    for (const build of dataCases) {
      const c = await build(ctx);
      expect([...captions(c), ...(c.labels ?? []).map((l) => l.text)].join('\n')).not.toContain('\u2014');
    }
  });
});

describe('writeRuleExamples', () => {
  it('is deterministic and independent of case order', async () => {
    const a = join(tmp, 'a.json'), b = join(tmp, 'b.json');
    await writeRuleExamples(a, [tiny('b'), tiny('a')]);
    await writeRuleExamples(b, [tiny('a'), tiny('b')]);
    expect(readFileSync(a)).toEqual(readFileSync(b));
    const parsed = JSON.parse(readFileSync(a, 'utf8')) as { version: number; cases: { id: string }[] };
    expect(parsed.version).toBe(1);
    expect(parsed.cases.map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('enforces the size budget', async () => {
    await expect(writeRuleExamples(join(tmp, 'big.json'), [tiny('big', 'x'.repeat(MAX_BYTES))])).rejects.toBeInstanceOf(DataError);
  });

  it('rejects an invalid case and duplicate ids', async () => {
    await expect(writeRuleExamples(join(tmp, 'bad.json'), [{ ...tiny('a'), steps: [] }])).rejects.toBeInstanceOf(DataError);
    await expect(writeRuleExamples(join(tmp, 'dup.json'), [tiny('a'), tiny('a')])).rejects.toBeInstanceOf(DataError);
  });
});

describe('projectWindow', () => {
  const sq = (x: number, y: number, s: number): BlockPolygons => [[[[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]]]];
  const blk = (geoid: string): Block => ({ geoid, pop: 1, point: [0, 0], rings: [] });

  it('fits the window, keeps north up, rounds to one decimal and drops the closing point', () => {
    const polys = new Map<string, BlockPolygons>([['a', sq(-100, 40, 0.01)], ['b', sq(-99.98, 40.02, 0.01)]]);
    const { rings } = projectWindow([blk('a'), blk('b')], polys, { w: 320, h: 180 });
    const a = rings.get('a')!, b = rings.get('b')!;
    expect(a).toHaveLength(4);
    for (const p of [...a, ...b]) {
      expect(p[0]).toBeGreaterThanOrEqual(8 - 0.1);
      expect(p[0]).toBeLessThanOrEqual(312.1);
      expect(p[1]).toBeGreaterThanOrEqual(8 - 0.1);
      expect(p[1]).toBeLessThanOrEqual(172.1);
      expect(p[0]).toBe(Math.round(p[0] * 10) / 10);
    }
    // b is north-east of a, so its smallest screen y is smaller (north up) and its x is larger.
    expect(Math.min(...b.map((p) => p[1]))).toBeLessThan(Math.min(...a.map((p) => p[1])));
    expect(Math.min(...b.map((p) => p[0]))).toBeGreaterThan(Math.min(...a.map((p) => p[0])));
  });

  it('simplifies collinear detail away', () => {
    const edge = Array.from({ length: 50 }, (_, i): [number, number] => [-100 + i * 0.0002, 40]);
    const ring: [number, number][] = [...edge, [-99.99, 40], [-99.99, 40.01], [-100, 40.01], [-100, 40]];
    const { rings } = projectWindow([blk('a')], new Map([['a', [[ring]]]]), { w: 320, h: 180 });
    expect(rings.get('a')!.length).toBeLessThan(10);
  });

  it('is empty-safe', () => {
    expect(projectWindow([], new Map(), { w: 10, h: 10 }).rings.size).toBe(0);
  });
});

describe('pieceMembers', () => {
  it('selects districts firstDistrict+1 .. firstDistrict+seats', () => {
    const before = new Map([['a', 1], ['b', 2], ['c', 3], ['d', 4]]);
    expect([...pieceMembers(before, 1, 2)].sort()).toEqual(['b', 'c']);
    expect([...pieceMembers(before, 0, 4)].sort()).toEqual(['a', 'b', 'c', 'd']);
  });
});

// ---- fake in-memory context: these run everywhere, with no out/ or data/raw ----
const HASH = 'a'.repeat(64);
function fakeCtx(opts: { repeatHash?: string | undefined; chosenLowSeats?: number } = {}): ExtractContext {
  const hasRepeat = !('repeatHash' in opts) || opts.repeatHash !== undefined;
  const metrics = (state: string, seats: number, population: number, ideal: number, hash: string, pops: number[]) => ({
    state, angleStepDeg: 0.1, nodeVersion: 'v24', inputSha256: 'x', seats, population, ideal,
    districts: pops.map((pop, i) => ({ district: i + 1, pop, dev: 0, devPct: 0, contiguous: true })),
    rangePersons: 1, rangePct: 0, allContiguous: true, assignmentSha256: hash,
  });
  const outputs: Record<string, StateOutput> = {
    AL: {
      metrics: metrics('AL', 7, 5024279, 5024279 / 7, HASH, [717754, 717754]),
      candidates: { fields: ['k', 'lowSeats', 'lengthM'], cuts: [[[850, 3, 479246], [850, 4, 642462], [851, 4, 111]]] },
      cutStats: { cuts: [{ order: 1, depth: 0, seats: 7, firstDistrict: 0, angleDeg: 85, lengthM: opts.chosenLowSeats === 4 ? 642462 : 479246 }] },
      balance: { before: [1], moves: [] }, assignment: new Map(), before: new Map(),
    },
    CO: {
      metrics: metrics('CO', 8, 5773714, 721714.25, HASH, [721714, 721715, 721714, 721715, 721714, 721715, 721714, 721715]),
      candidates: { fields: [], cuts: [] }, cutStats: { cuts: [] }, balance: { before: [1], moves: [] }, assignment: new Map(), before: new Map(),
    },
  };
  return {
    cfg: parseRuleExamplesConfig([]),
    state: async (abbr) => outputs[abbr]!,
    repeatMetrics: async () => (hasRepeat ? metrics('CO', 8, 5773714, 721714.25, opts.repeatHash ?? HASH, []) : undefined),
    blocks: async () => { throw new Error('not needed'); },
  };
}

describe('data case builders (fake context)', () => {
  it('shareCase uses the low-side seat count from the cut record, not a recomputed split', async () => {
    const three = captions(await shareCase(fakeCtx())).at(-1)!;
    expect(three).toContain('5,024,279');
    expect(three).toContain('2,153,262.43');
    const four = captions(await shareCase(fakeCtx({ chosenLowSeats: 4 }))).at(-1)!;
    expect(four).toContain('2,871,016.57');
    expect(four).not.toContain('2,153,262.43');
  });

  it('idealCase states the population, seats, ideal and both whole targets', async () => {
    const c = await idealCase(fakeCtx());
    const text = captions(c).join(' ');
    for (const s of ['5,773,714', '8', '721,714.25', '721,714', '721,715']) expect(text).toContain(s);
    expect(c.chart?.marks?.onTarget).toHaveLength(8);
  });

  it('fingerprintCase carries both hashes when they match', async () => {
    const c = await fingerprintCase(fakeCtx());
    expect(c.labels?.map((l) => l.text)).toEqual([HASH, HASH]);
    expect(c.missing).toBeUndefined();
  });

  it('fingerprintCase throws a DataError when the hashes differ', async () => {
    await expect(fingerprintCase(fakeCtx({ repeatHash: 'b'.repeat(64) }))).rejects.toBeInstanceOf(DataError);
  });

  it('fingerprintCase is marked missing when there is no repeat run', async () => {
    const c = await fingerprintCase(fakeCtx({ repeatHash: undefined }));
    expect(c.missing).toBeTruthy();
  });

  it('extractRuleExamples writes the cases of the builders it is given', async () => {
    const dest = join(tmp, 'extract.json');
    const builder: CaseBuilder = async () => tiny('only');
    const r = await extractRuleExamples({ ...parseRuleExamplesConfig([]), dest }, [builder]);
    expect(r.cases).toBe(1);
    expect(JSON.parse(readFileSync(dest, 'utf8')).cases.map((c: { id: string }) => c.id)).toEqual(['only']);
  });
});

describe('committed public/data/how/rule-examples.json', () => {
  const path = 'public/data/how/rule-examples.json';
  const raw = readFileSync(path, 'utf8');
  const file = RuleExamplesSchema.parse(JSON.parse(raw));

  it('is within the size budget and has no em dash anywhere', () => {
    expect(Buffer.byteLength(raw)).toBeLessThan(MAX_BYTES);
    expect(raw).not.toContain('\u2014');
  });

  it('fingerprint.repeat carries two equal hashes', () => {
    const c = file.cases.find((x) => x.id === 'fingerprint.repeat')!;
    expect(c.missing).toBeUndefined();
    const hashes = (c.labels ?? []).filter((l) => l.tag === 'hash').map((l) => l.text);
    expect(hashes).toHaveLength(2);
    expect(hashes[0]).toBe(hashes[1]);
    expect(hashes[0]).toMatch(/^[0-9a-f]{64}$/);
  });
});
