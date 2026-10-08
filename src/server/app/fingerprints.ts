import { readFileSync, writeFileSync } from 'node:fs';
import { ReleaseConfigSchema, compareFingerprints } from '../features/release/index.js';
import { VERSIONS, parseFingerprintArgs } from '../shared/config/index.js';
import { exitCodeFor } from '../shared/errors/index.js';
import { FINGERPRINT_PATH, drawFingerprints, readFingerprintFile } from './fixtures.js';

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

  const recorded = readFingerprintFile();
  const names = args.states ?? Object.keys(recorded.states);
  const file = { ...recorded, states: Object.fromEntries(Object.entries(recorded.states).filter(([st]) => names.includes(st))) };
  if (Object.keys(file.states).length === 0) {
    console.log(`::notice::${FINGERPRINT_PATH} records no fixture states yet, so the fixture gate passes vacuously (the 1.0 cut records them)`);
    return;
  }
  const result = compareFingerprints(file, drawFingerprints(Object.keys(file.states), args.cacheDir), engineMajor);
  console.log(result.message);
  if (!result.ok) process.exit(1);
}

try {
  main();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(exitCodeFor(err));
}
