import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { FingerprintFileSchema, type FingerprintFile, type StateFingerprint } from '../features/release/index.js';
import { parseChamber, planDir, type Chamber } from '../shared/chamber/index.js';
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
  return parseFingerprintFile(text, `${ref}:${FINGERPRINT_PATH}`);
}

/** Parse fingerprint file text; text that is not JSON, or does not match the schema, is a DataError naming `label`. */
export function parseFingerprintFile(text: string, label: string): FingerprintFile {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new DataError(`${label}: not valid JSON`);
  }
  const parsed = FingerprintFileSchema.safeParse(json);
  if (!parsed.success) throw new DataError(`${label}: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
  return parsed.data;
}

const Metrics = z.object({ assignmentSha256: z.string().regex(/^[0-9a-f]{64}$/) });

function readSha(out: string, abbr: string, chamber: Chamber, ...plan: string[]): string {
  const file = join(out, planDir(abbr, chamber), ...plan, 'metrics.json');
  const metrics = Metrics.safeParse(JSON.parse(readFileSync(file, 'utf8')));
  if (!metrics.success) throw new DataError(`${abbr} ${chamber}: ${join(...plan, 'metrics.json')} has no assignmentSha256`);
  return metrics.data.assignmentSha256;
}

/** `VT` is the Federal House; `VT:state-senate` is that state's chamber. */
function splitFixtureId(id: string): { abbr: string; chamber: Chamber } {
  const [abbr = '', chamber] = id.split(':');
  return { abbr, chamber: chamber === undefined ? 'federal-house' : parseChamber(chamber) };
}

/**
 * Draws each fixture with `explore` into a temporary directory (one run per chamber) and returns its fingerprints: the
 * assignment sha before balancing and of the finished plan. Keys come back sorted so the recorded file is deterministic.
 */
export function drawFingerprints(ids: readonly string[], cacheDir: string): Record<string, StateFingerprint> {
  const out = mkdtempSync(join(tmpdir(), 'fixture-gate-'));
  try {
    const cli = fileURLToPath(new URL('./cli.ts', import.meta.url));
    const byChamber = new Map<Chamber, string[]>();
    for (const id of ids) {
      const { abbr, chamber } = splitFixtureId(id);
      byChamber.set(chamber, [...(byChamber.get(chamber) ?? []), abbr]);
    }
    for (const [chamber, abbrs] of byChamber) {
      const run = spawnSync(
        process.execPath,
        ['--max-old-space-size=8192', '--import', 'tsx', cli, '--states', abbrs.join(','), '--chamber', chamber, '--cache-dir', cacheDir, '--out-dir', out],
        { stdio: 'inherit' },
      );
      if (run.status !== 0) throw new DataError(`explore failed for the ${chamber} fixture states (exit ${String(run.status)})`);
    }
    const got: Record<string, StateFingerprint> = {};
    for (const id of [...ids].sort()) {
      const { abbr, chamber } = splitFixtureId(id);
      got[id] = { before: readSha(out, abbr, chamber, 'before-balancing'), finished: readSha(out, abbr, chamber) };
    }
    return got;
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}
