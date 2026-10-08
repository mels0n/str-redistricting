import { readFileSync, writeFileSync } from 'node:fs';
import {
  COMPONENTS,
  ReleaseConfigSchema,
  compareFingerprints,
  componentsFor,
  prependEntry,
  proposeVersions,
  tagsFor,
  type Commit,
  type Component,
} from '../features/release/index.js';
import { VersionsSchema, formatVersions, inputSha256Of, parseReleaseArgs, type Versions } from '../shared/config/index.js';
import { exitCodeFor } from '../shared/errors/index.js';
import { FINGERPRINT_PATH, drawFingerprints, readFingerprintFile } from './fixtures.js';
import { commit, commitsSince, tagExists } from './git.js';

// Reads config/ and changelog/ relative to the current directory, and proposes the next versions from the commits
// since each component's last release tag.

const readText = (path: string): string => readFileSync(path, 'utf8');

/** The tag of each component's current version, in the order tagsFor lists them. */
function currentTags(v: Versions): Record<Component, string> {
  const tags = tagsFor(null, v);
  return Object.fromEntries(COMPONENTS.map((c, i) => [c, tags[i]!])) as Record<Component, string>;
}

function identityOf(v: Versions, c: Component): string {
  return c === 'input' ? `${v.input.vintage} r${v.input.revision}` : String(v[c]);
}

/** Commit subjects as changelog bullets; the changelogs are rendered on the site, which has no em dashes. */
function bullets(commits: readonly Commit[]): string[] {
  const seen = new Set<string>();
  for (const c of commits) seen.add(c.subject.replace(/\s*—\s*/g, ', '));
  return [...seen];
}

function release(): void {
  const args = parseReleaseArgs(process.argv.slice(2));
  const cfg = ReleaseConfigSchema.parse(JSON.parse(readText('config/release.json')));
  const current = VersionsSchema.parse(JSON.parse(readText('config/versions.json')));

  const tags = currentTags(current);
  const found = COMPONENTS.filter((c) => tagExists(tags[c]));
  if (found.length === 0) {
    console.log('no release tags yet; versions are the 1.0 baseline');
    return;
  }
  // A component whose current tag is missing is measured from the first tag that does exist.
  const fallback = tags[found[0]!];

  const byComponent = new Map<Component, Commit[]>();
  for (const c of COMPONENTS) {
    const ref = tagExists(tags[c]) ? tags[c] : fallback;
    byComponent.set(c, commitsSince(ref).filter((k) => componentsFor(k, cfg).has(c)));
  }

  // Fixture gate: a changed fingerprint under an unchanged engine major means the maps changed.
  let engineOutputChanged = false;
  const recorded = readFingerprintFile();
  if (Object.keys(recorded.states).length === 0) {
    console.log(`${FINGERPRINT_PATH} records no fixture states yet; the fixture gate is vacuous`);
  } else {
    const result = compareFingerprints(recorded, drawFingerprints(Object.keys(recorded.states), args.cacheDir), Number(current.engine.split('.')[0]));
    console.log(result.message);
    engineOutputChanged = !result.ok;
  }

  const inputSha256 = inputSha256Of(readText('config/census-sha256.json'), readText('config/enacted.json'));
  const { next, reasons } = proposeVersions(current, { byComponent, engineOutputChanged, inputSha256 });
  const moved = COMPONENTS.filter((c) => identityOf(current, c) !== identityOf(next, c));
  if (moved.length === 0) {
    console.log('nothing to release');
    return;
  }
  const subject = `release: ${moved.map((c) => (c === 'input' ? `input ${identityOf(next, c)}` : `${c} ${identityOf(next, c)}`)).join(', ')}`;
  console.log(`${subject}\n${reasons.map((r) => `  ${r}`).join('\n')}`);
  if (args.dryRun) {
    console.log(formatVersions(next));
    return;
  }

  const date = new Date().toISOString().slice(0, 10);
  const files = ['config/versions.json'];
  writeFileSync('config/versions.json', formatVersions(next));
  for (const c of moved) {
    const path = `changelog/${c}.md`;
    const lines = bullets(byComponent.get(c) ?? []);
    writeFileSync(path, prependEntry(readText(path), identityOf(next, c), date, lines.length > 0 ? lines : ['Pinned input files changed.']));
    files.push(path);
  }
  commit(files, subject);
  console.log(`committed ${subject}`);
}

try {
  release();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(exitCodeFor(err));
}
