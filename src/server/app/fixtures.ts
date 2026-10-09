import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { FingerprintFileSchema, type FingerprintFile } from '../features/release/index.js';
import { DataError } from '../shared/errors/index.js';
import { showFile } from './git.js';

export const FINGERPRINT_PATH = 'tests/fingerprints/engine.json';

export function readFingerprintFile(path = FINGERPRINT_PATH): FingerprintFile {
  const parsed = FingerprintFileSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
  if (!parsed.success) throw new DataError(`${path}: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
  return parsed.data;
}

/** The fingerprint file as committed at `ref`; a ref without one counts as recording no states (before the cut). */
export function readFingerprintFileAt(ref: string): FingerprintFile {
  const text = showFile(ref, FINGERPRINT_PATH);
  if (text === null) return { engineMajor: 1, states: {} };
  const parsed = FingerprintFileSchema.safeParse(JSON.parse(text));
  if (!parsed.success) throw new DataError(`${ref}:${FINGERPRINT_PATH}: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
  return parsed.data;
}

const Metrics = z.object({ assignmentSha256: z.string().regex(/^[0-9a-f]{64}$/) });

/** Draws each state with `explore` into a temporary directory and returns its assignment fingerprint. */
export function drawFingerprints(states: readonly string[], cacheDir: string): Record<string, string> {
  const out = mkdtempSync(join(tmpdir(), 'fixture-gate-'));
  try {
    const cli = fileURLToPath(new URL('./cli.ts', import.meta.url));
    const run = spawnSync(
      process.execPath,
      ['--max-old-space-size=8192', '--import', 'tsx', cli, '--states', states.join(','), '--cache-dir', cacheDir, '--out-dir', out],
      { stdio: 'inherit' },
    );
    if (run.status !== 0) throw new DataError(`explore failed for the fixture states (exit ${String(run.status)})`);
    const got: Record<string, string> = {};
    for (const st of states) {
      const metrics = Metrics.safeParse(JSON.parse(readFileSync(join(out, st, 'metrics.json'), 'utf8')));
      if (!metrics.success) throw new DataError(`${st}: metrics.json has no assignmentSha256`);
      got[st] = metrics.data.assignmentSha256;
    }
    return got;
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}
