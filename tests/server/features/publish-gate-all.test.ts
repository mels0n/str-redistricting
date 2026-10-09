import { createHash } from 'node:crypto';
import type { GatedPlans } from '../../../src/server/features/publish/index.js';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { blocksFileName } from '../../../src/server/entities/census-block/index.js';
import { stateByAbbr } from '../../../src/server/shared/apportionment/index.js';
import { DEFAULT_ANGLE_STEP_DEG, pinnedSha256, stampOf, VERSIONS } from '../../../src/server/shared/config/index.js';
import { DataError } from '../../../src/server/shared/errors/index.js';

const { assertGatedAssignments, publishData } = await import('../../../src/server/features/publish/index.js');
const { parsePublishConfig } = await import('../../../src/server/shared/config/index.js');

/** A plan's metrics drawn by this engine from the pinned census file, unless `over` says otherwise. */
const metricsOf = (abbr: string, sha: string, over: Record<string, unknown> = {}) => {
  const published = JSON.parse(readFileSync(new URL(`../../../public/data/${abbr}/stats.json`, import.meta.url), 'utf8')) as { finished: { metrics: object } };
  return {
    ...published.finished.metrics, districts: [], assignmentSha256: sha, engine: VERSIONS.engine, angleStepDeg: DEFAULT_ANGLE_STEP_DEG,
    inputSha256: pinnedSha256(blocksFileName(stateByAbbr(abbr)!)),
    cuts: 1, angleCount: 1800, directionsPerCut: [1800], candidateLinesEvaluated: 1, strayBlocksMoved: 0, strayPopMoved: 0, recounts: 0, recountsMaxPerCut: 0,
    balanceMoves: 0, peopleMovedByBalancing: 0, rangeBeforeBalancing: 0, rangeAfterBalancing: 0, ...over,
  };
};

let root: string;
const put = (path: string, body: unknown): void => {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(body));
};
const snapshot = (dir: string): string[] => readdirSync(dir, { recursive: true, encoding: 'utf8' }).sort();
const A = 'a'.repeat(64);
const B = 'b'.repeat(64);

/** A generated plan pair in `out` and a published state in `pub`. */
const state = (out: string, pub: string, abbr: string, o: { published: [string, string]; generated: [string, string]; over?: Record<string, unknown>; beforeOver?: Record<string, unknown> }): void => {
  put(join(out, abbr, 'metrics.json'), metricsOf(abbr, o.generated[0], o.over));
  put(join(out, abbr, 'before-balancing', 'metrics.json'), metricsOf(abbr, o.generated[1], o.beforeOver ?? o.over));
  put(join(pub, abbr, 'stats.json'), {
    versions: stampOf(VERSIONS), finished: { metrics: metricsOf(abbr, o.published[0]) }, beforeBalancing: { metrics: metricsOf(abbr, o.published[1]) },
  });
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'gate-all-'));
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

const run = (out: string, pub: string, states: string) => publishData(parsePublishConfig(['--out-dir', out, '--public-dir', pub, '--states', states]));

describe('publishData gate', () => {
  it('refuses before writing anything when a later state is refused', async () => {
    const out = join(root, 'out');
    const pub = join(root, 'public');
    // CO comes first in state order and would pass (same map); RI changed under the same versions and is refused.
    state(out, pub, 'CO', { published: [A, A], generated: [A, A] });
    state(out, pub, 'RI', { published: [A, A], generated: [B, B] });
    const before = snapshot(pub);
    await expect(run(out, pub, 'CO,RI')).rejects.toThrow(/RI: the map changed/);
    expect(snapshot(pub)).toEqual(before);
  });

  it('refuses a map that changed only before balancing', async () => {
    const out = join(root, 'out');
    const pub = join(root, 'public');
    state(out, pub, 'RI', { published: [A, A], generated: [A, B] });
    await expect(run(out, pub, 'RI')).rejects.toThrow(/RI: the map changed/);
  });
});

describe('publishData provenance', () => {
  const refused = async (over: Record<string, unknown>, beforeOver: Record<string, unknown> | undefined, pattern: RegExp): Promise<void> => {
    const out = join(root, 'out');
    const pub = join(root, 'public');
    state(out, pub, 'RI', { published: [A, A], generated: [A, A], over, ...(beforeOver ? { beforeOver } : {}) });
    const before = snapshot(pub);
    await expect(run(out, pub, 'RI')).rejects.toThrow(pattern);
    expect(snapshot(pub)).toEqual(before);
  };

  it('refuses a plan with no engine field', () => refused({ engine: undefined }, undefined, /RI: the plan cannot be published, it records no engine version; re-run `npm run explore -- --states RI`/));
  it('refuses a plan from another engine major', () => refused({ engine: '99.0.0' }, undefined, /RI: .*engine 99\.0\.0.*different major/));
  it('refuses a plan drawn from a census file other than the pinned one', () => refused({ inputSha256: B }, undefined, /not the pinned one/));
  it('refuses a plan drawn at another angle step', () => refused({ angleStepDeg: 0.5 }, undefined, /angle step is 0.5/));
  it('checks the before-balancing plan too', () => refused({}, { engine: '99.0.0' }, /RI before-balancing: .*different major/));
});

describe('assertGatedAssignments', () => {
  const sha = (text: string): string => createHash('sha256').update(text).digest('hex');
  const plans = (finished: string, before: string) => ({ finished: { assignmentSha256: sha(finished) }, before: { assignmentSha256: sha(before) } }) as unknown as GatedPlans;

  it('accepts assignment files that hash to what the gate checked', () => {
    expect(() => assertGatedAssignments('RI', plans('a', 'b'), 'a', 'b')).not.toThrow();
  });

  it('throws a DataError naming the state when either assignment.csv changed after the check', () => {
    for (const [finished, before] of [['changed', 'b'], ['a', 'changed']] as const) {
      const err = (() => { try { assertGatedAssignments('RI', plans('a', 'b'), finished, before); } catch (e) { return e; } })();
      expect(err).toBeInstanceOf(DataError);
      expect((err as Error).message).toBe('RI: out/RI changed after it was checked; do not run explore while publish-data runs');
    }
  });
});

describe('publishData requested states', () => {
  it('throws, listing every requested state with no plan, before writing anything', async () => {
    const out = join(root, 'out');
    const pub = join(root, 'public');
    state(out, pub, 'RI', { published: [A, A], generated: [A, A] });
    const before = snapshot(pub);
    const err = await run(out, pub, 'RI,CO,DE').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DataError);
    expect((err as Error).message).toMatch(/CO, DE/);
    expect((err as Error).message).not.toMatch(/RI/);
    expect(snapshot(pub)).toEqual(before);
  });
});
