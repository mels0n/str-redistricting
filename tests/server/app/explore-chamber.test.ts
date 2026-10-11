import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { FingerprintFileSchema } from '../../../src/server/features/release/index.js';

const cli = fileURLToPath(new URL('../../../src/server/app/cli.ts', import.meta.url));
const sha = 'a'.repeat(64);
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function explore(out: string, state: string, chamber: string): { status: number | null; stdout: string } {
  const run = spawnSync(process.execPath, ['--import', 'tsx', cli, '--states', state, '--chamber', chamber, '--out-dir', out, '--threads', '1'], { encoding: 'utf8' });
  return { status: run.status, stdout: run.stdout };
}

const hashTree = (dir: string): string[] =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => `${join(e.parentPath, e.name)}:${createHash('sha256').update(readFileSync(join(e.parentPath, e.name))).digest('hex')}`)
    .sort();

describe('explore per chamber', () => {
  it('writes nothing for a state without that chamber (NE has no State House)', () => {
    const out = mkdtempSync(join(tmpdir(), 'explore-chamber-'));
    dirs.push(out);
    const run = explore(out, 'NE', 'state-house');
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('no State House to draw');
    expect(existsSync(join(out, 'NE'))).toBe(false);
  });

  it('draws a state chamber beside the Federal House without touching its files', { timeout: 600_000 }, () => {
    const out = mkdtempSync(join(tmpdir(), 'explore-chamber-'));
    dirs.push(out);
    expect(explore(out, 'VT', 'federal-house').status).toBe(0);
    const before = hashTree(join(out, 'VT')).filter((l) => !l.includes('state-senate'));
    expect(explore(out, 'VT', 'state-senate').status).toBe(0);
    expect(existsSync(join(out, 'VT', 'state-senate', 'metrics.json'))).toBe(true);
    expect(hashTree(join(out, 'VT')).filter((l) => !l.includes('state-senate'))).toEqual(before);
  });
});

describe('fixture ids in the fingerprint file', () => {
  it('accepts a chamber id and rejects a malformed one', () => {
    const fp = { before: sha, finished: sha };
    expect(FingerprintFileSchema.safeParse({ engineMajor: 1, states: { 'VT:state-senate': fp } }).success).toBe(true);
    expect(FingerprintFileSchema.safeParse({ engineMajor: 1, states: { 'VT:senate': fp } }).success).toBe(false);
  });
});
