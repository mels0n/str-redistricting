import { readFileSync } from 'node:fs';
import { COMPONENTS, ReleaseConfigSchema, componentsFor, versionProblems, type Component } from '../features/release/index.js';
import { VersionsSchema, parseVersionCheckArgs } from '../shared/config/index.js';
import { DataError, exitCodeFor } from '../shared/errors/index.js';
import { changedFiles, commitsSince, showFile } from './git.js';

// Compares config/versions.json at --base and at HEAD with what the pull request touched. Reads config/release.json
// from the current directory. Warns until release.json says enforce, then fails.

function check(): void {
  const { base } = parseVersionCheckArgs(process.argv.slice(2));
  const baseText = showFile(base, 'config/versions.json');
  if (baseText === null) {
    console.log(`::notice::${base} has no config/versions.json, so there is nothing to compare against`);
    return;
  }
  const headText = showFile('HEAD', 'config/versions.json');
  if (headText === null) throw new DataError('config/versions.json is missing at HEAD');
  const cfg = ReleaseConfigSchema.parse(JSON.parse(readFileSync('config/release.json', 'utf8')));

  // Only files still different at HEAD count, so a file changed and put back in the same PR is not "touched".
  const net = new Set(changedFiles(base, 'HEAD'));
  const touched = new Set<Component>();
  for (const c of commitsSince(base)) {
    for (const comp of componentsFor({ ...c, files: c.files.filter((f) => net.has(f)) }, cfg)) touched.add(comp);
  }

  const changelogs = Object.fromEntries(COMPONENTS.map((c) => [c, showFile('HEAD', `changelog/${c}.md`) ?? ''])) as Record<Component, string>;
  const problems = versionProblems({
    base: VersionsSchema.parse(JSON.parse(baseText)),
    head: VersionsSchema.parse(JSON.parse(headText)),
    touched,
    changelogs,
  });
  if (problems.length === 0) {
    console.log('version-check: ok');
    return;
  }
  const level = cfg.enforce ? 'error' : 'warning';
  for (const p of problems) console.log(`::${level}::${p}`);
  if (cfg.enforce) process.exit(1);
}

try {
  check();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(exitCodeFor(err));
}
