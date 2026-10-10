import { readFileSync, writeFileSync } from 'node:fs';
import { ReleaseConfigSchema, baseEngineMajor, compareFingerprints, isPreRelease } from '../features/release/index.js';
import { VERSIONS, parseFingerprintArgs } from '../shared/config/index.js';
import { exitCodeFor } from '../shared/errors/index.js';
import { FINGERPRINT_PATH, drawFingerprints, readFingerprintFile, readFingerprintFileAt } from './fixtures.js';
import { listTags, showFile } from './git.js';

function tagsOrNone(): string[] {
  try {
    return listTags();
  } catch {
    return [];
  }
}

// Reads config/ and tests/ relative to the current directory.
function main(): void {
  const args = parseFingerprintArgs(process.argv.slice(2));
  const release = ReleaseConfigSchema.parse(JSON.parse(readFileSync('config/release.json', 'utf8')));
  const states = args.states ?? release.fixtureStates;
  const engineMajor = Number(VERSIONS.engine.split('.')[0]);

  if (args.mode === 'record') {
    const got = drawFingerprints(states, args.cacheDir);
    writeFileSync(FINGERPRINT_PATH, `${JSON.stringify({ engineMajor, states: got }, null, 2)}\n`);
    console.log(`recorded ${states.join(', ')} at engine major ${engineMajor}`);
    return;
  }

  // The base is the branch being merged into, never the pull request's own file: a pull request cannot pass by
  // rewriting the fingerprints it is judged against.
  const head = readFingerprintFile();
  const recorded = args.base === undefined ? head : readFingerprintFileAt(args.base);
  const names = args.states ?? Object.keys(recorded.states);
  // The major to beat is the one the base's config/versions.json declares, not the one its fingerprint file recorded.
  const baseMajor = args.base === undefined ? recorded.engineMajor : baseEngineMajor(showFile(args.base, 'config/versions.json'), recorded.engineMajor);
  const base = { engineMajor: baseMajor, states: Object.fromEntries(Object.entries(recorded.states).filter(([st]) => names.includes(st))) };
  if (Object.keys(base.states).length === 0) {
    console.log(`::notice::${args.base ?? 'the working copy'} records no fixture states in ${FINGERPRINT_PATH} yet, so the fixture gate passes vacuously (the 1.0 cut records them)`);
    return;
  }
  // Pre-release is judged by the base ref's config (a missing file counts as not enforcing), so a pull request cannot
  // switch the gate off by editing its own config/release.json.
  const baseReleaseText = args.base === undefined ? null : showFile(args.base, 'config/release.json');
  const baseRelease = baseReleaseText === null ? { ...release, enforce: false } : ReleaseConfigSchema.parse(JSON.parse(baseReleaseText));
  const preRelease = isPreRelease(args.base === undefined ? release : baseRelease, tagsOrNone());
  const result = compareFingerprints(base, head, drawFingerprints(Object.keys(base.states), args.cacheDir), engineMajor, preRelease);
  if (result.changed.length > 0) console.log(`changed fixture states: ${result.changed.join(', ')}`);
  console.log(result.message);
  if (!result.ok) process.exit(1);
}

try {
  main();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(exitCodeFor(err));
}
