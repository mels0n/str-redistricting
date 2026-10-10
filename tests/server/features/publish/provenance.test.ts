import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { staleReason, writeStamp, type RunKey } from '../../../../src/server/features/run-stamp/index.js';
import { DataError } from '../../../../src/server/shared/errors/index.js';

const { publishData } = await import('../../../../src/server/features/publish/index.js');
const { parsePublishConfig } = await import('../../../../src/server/shared/config/index.js');

const HEX = (c: string): string => c.repeat(64);
const KEY: RunKey = { inputSha256: HEX('1'), seats: 2, engineMajor: '1', codeSha256: HEX('2') };

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'publish-stamp-'));
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

/** A state folder with a plan file, stamped from `key` unless it is undefined. */
async function plan(out: string, abbr: string, key: RunKey | undefined): Promise<void> {
  const dir = join(out, abbr);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'metrics.json'), '{}');
  if (key) {
    const { createHash } = await import('node:crypto');
    await writeStamp(dir, { ...key, files: [{ path: 'metrics.json', sha256: createHash('sha256').update('{}').digest('hex') }] });
  }
}

const run = (out: string, pub: string, states: string, current: RunKey) =>
  publishData(parsePublishConfig(['--out-dir', out, '--public-dir', pub, '--states', states]), { planStale: (_s, dir) => staleReason(dir, current) });

describe('publishData run stamp', () => {
  it('refuses a plan with no inputs.json', async () => {
    const out = join(root, 'out');
    await plan(out, 'RI', undefined);
    const err = await run(out, join(root, 'pub'), 'RI', KEY).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DataError);
    expect((err as Error).message).toMatch(/^RI: no complete earlier run; re-run explore for it$/);
  });

  it('refuses a plan drawn by other code', async () => {
    const out = join(root, 'out');
    await plan(out, 'RI', { ...KEY, codeSha256: HEX('3') });
    await expect(run(out, join(root, 'pub'), 'RI', KEY)).rejects.toThrow(/RI: code changed/);
  });

  it('asks the check about the state and its folder, and a valid stamp moves on to reading the plan', async () => {
    const out = join(root, 'out');
    await plan(out, 'RI', KEY);
    const planStale = vi.fn((_s: unknown, dir: string) => staleReason(dir, KEY));
    const err = await publishData(parsePublishConfig(['--out-dir', out, '--public-dir', join(root, 'pub'), '--states', 'RI']), { planStale }).catch((e: unknown) => e);
    expect(planStale).toHaveBeenCalledTimes(1);
    expect(planStale.mock.calls[0]![0]).toMatchObject({ abbr: 'RI' });
    expect(planStale.mock.calls[0]![1]).toBe(join(out, 'RI'));
    // The stub metrics.json is not a real plan, so the run stops reading it, after the stamp check passed.
    expect((err as Error).message).toMatch(/metrics\.json: .*Invalid input/);
  });

  it('writes nothing when one of two states is refused', async () => {
    const out = join(root, 'out');
    const pub = join(root, 'pub');
    mkdirSync(pub, { recursive: true });
    await plan(out, 'CO', KEY);
    await plan(out, 'RI', undefined);
    await expect(run(out, pub, 'CO,RI', KEY)).rejects.toThrow(/RI: no complete earlier run/);
    expect(readdirSync(pub)).toEqual([]);
  });
});
