import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { Block, BlockPolygons } from '../../../src/server/entities/census-block/index.js';
import {
  createExtractContext, CASES, MAX_BYTES, pieceMembers, projectWindow, writeRuleExamples, type RuleCase,
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
  id, state: 'XX', source: {}, link: { state: 'XX' }, view: { w: 10, h: 10 }, steps: [{ caption, show: [] }],
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
    for (const build of CASES) {
      const c = await build(ctx);
      expect([...captions(c), ...(c.labels ?? []).map((l) => l.text)].join('\n')).not.toContain('—');
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
