import { readFileSync } from 'node:fs';
import { COMPONENTS, ReleaseConfigSchema, componentsFor, mapsDataChanged, versionProblems, type Component } from '../features/release/index.js';
import { VersionsSchema, parseVersionCheckArgs } from '../shared/config/index.js';
import { CheckFailedError, DataError, exitCodeFor } from '../shared/errors/index.js';
import { FINGERPRINT_PATH, parseFingerprintFile } from './fixtures.js';
import { changedFiles, commitsSince, mergeBase, showFile } from './git.js';

// Compares config/versions.json at --base and at HEAD with what the pull request touched, and public/data/index.json
// at both for the maps release. Reads config/release.json from --base, so a pull request cannot loosen its own check
// (HEAD's copy is used only when the base has none). Warns until release.json says enforce, then fails.

/** The engine major recorded at HEAD; null only when there is no fingerprint file. A malformed file is an error, never "no major". */
function headFingerprintMajor(): number | null {
  const text = showFile('HEAD', FINGERPRINT_PATH);
  return text === null ? null : parseFingerprintFile(text, `HEAD:${FINGERPRINT_PATH}`).engineMajor;
}

function check(): void {
  const { base } = parseVersionCheckArgs(process.argv.slice(2));
  if (mergeBase(base, 'HEAD') === null) throw new DataError(`no common history with ${base}; rebase this branch onto ${base}`);
  const baseText = showFile(base, 'config/versions.json');
  if (baseText === null) {
    console.log(`::notice::${base} has no config/versions.json, so there is nothing to compare against`);
    return;
  }
  const headText = showFile('HEAD', 'config/versions.json');
  if (headText === null) throw new DataError('config/versions.json is missing at HEAD');
  let cfgText = showFile(base, 'config/release.json');
  if (cfgText === null) {
    console.log(`::notice::${base} has no config/release.json, so this branch's copy is used`);
    cfgText = readFileSync('config/release.json', 'utf8');
  }
  const cfg = ReleaseConfigSchema.parse(JSON.parse(cfgText));

  // Only files still different at HEAD count, so a file changed and put back in the same PR is not "touched".
  const net = new Set(changedFiles(base, 'HEAD'));
  const touched = new Set<Component>();
  for (const c of commitsSince(base)) {
    for (const comp of componentsFor({ ...c, files: c.files.filter((f) => net.has(f)) }, cfg)) touched.add(comp);
  }

  const changelogs = Object.fromEntries(COMPONENTS.map((c) => [c, showFile('HEAD', `changelog/${c}.md`) ?? ''])) as Record<Component, string>;
  const baseVersions = VersionsSchema.parse(JSON.parse(baseText));
  const headVersions = VersionsSchema.parse(JSON.parse(headText));
  const problems = versionProblems({
    base: baseVersions,
    head: headVersions,
    touched,
    changelogs,
    headFingerprintMajor: headFingerprintMajor(),
    // Data stamped with a Maps release an earlier change already declared needs no further bump.
    mapsDataChanged: mapsDataChanged(showFile(base, 'public/data/index.json'), showFile('HEAD', 'public/data/index.json'), { base: baseVersions.maps, head: headVersions.maps }),
  });
  if (problems.length === 0) {
    console.log('version-check: ok');
    return;
  }
  const level = cfg.enforce ? 'error' : 'warning';
  for (const p of problems) console.log(`::${level}::${p}`);
  if (cfg.enforce) process.exit(exitCodeFor(new CheckFailedError(problems.join('; '))));
}

try {
  check();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(exitCodeFor(err));
}
