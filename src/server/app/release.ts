import { readFileSync, writeFileSync } from 'node:fs';
import {
  COMPONENTS,
  ReleaseConfigSchema,
  parseClassifyRules,
  compareFingerprints,
  componentsFor,
  mapsDataChanged,
  newestTag,
  prependEntry,
  proposeVersions,
  tagsFor,
  taggedVersions,
  type Commit,
  type Component,
  type ClassifyRules,
} from '../features/release/index.js';
import { VersionsSchema, formatVersions, inputSha256Of, parseReleaseArgs, type Versions } from '../shared/config/index.js';
import { exitCodeFor } from '../shared/errors/index.js';
import { FINGERPRINT_PATH, drawFingerprints, readFingerprintFile, readFingerprintFileAt } from './fixtures.js';
import { commit, commitsSince, commitsTouching, engineFilesAt, listTags, showFile } from './git.js';

// Reads config/ and changelog/ relative to the current directory, and proposes the next versions from the commits
// since each component's newest release tag. A component whose version already differs from its newest tag was bumped
// since, so it is not bumped again: running release twice in a row changes nothing the second time.

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

/** The changelog bullet for a moved component that no commit touched by path. */
const NO_COMMITS: Record<Component, string> = {
  engine: 'Maps drawn by the engine changed.',
  input: 'Pinned input files changed.',
  maps: 'Published maps rebuilt.',
  schema: 'Schema changed.',
  web: 'Site changed.',
  docs: 'Docs changed.',
};

function release(): void {
  const args = parseReleaseArgs(process.argv.slice(2));
  const cfg = ReleaseConfigSchema.parse(JSON.parse(readText('config/release.json')));
  const current = VersionsSchema.parse(JSON.parse(readText('config/versions.json')));

  const allTags = listTags();
  const newest = Object.fromEntries(COMPONENTS.map((c) => [c, newestTag(allTags, c)])) as Record<Component, string | null>;
  const found = COMPONENTS.filter((c) => newest[c] !== null);
  if (found.length === 0) {
    console.log('no release tags yet; versions are the 1.0 baseline');
    return;
  }
  // A component with no tag at all is measured from the first tag that does exist.
  const fallback = newest[found[0]!]!;
  const refOf = (c: Component): string => newest[c] ?? fallback;

  // Versions that already differ from the newest tag were bumped since the last release. The proposal is worked out
  // from the tag, and the higher of that and the current version wins, so a later feat or output change can still
  // raise a bump made since the tag, and running again with nothing new changes nothing.
  const expected = currentTags(current);
  const bumpedSince = COMPONENTS.filter((c) => newest[c] !== null && newest[c] !== expected[c]);
  if (bumpedSince.length > 0) console.log(`already bumped since their last tag: ${bumpedSince.join(', ')}`);

  // The rule change applies going forward only. A commit made while release.json named engineEntries (its first
  // parent's copy) is classed by the import graph; every earlier commit is classed exactly as the globs classed it at
  // the end of that era, which is how the release tooling has always judged history. Graph-era commits are judged
  // against today's entries plus the graph at the last engine release, so a file deleted since still counts.
  // Past copies of release.json are read leniently (see parseClassifyRules) and only when a commit needs them.
  let engineFiles: ReadonlySet<string> | undefined;
  const graphFor = (at: ClassifyRules): ReadonlySet<string> | undefined => {
    engineFiles ??= engineFilesAt(cfg.engineEntries === undefined ? at : cfg, [{ ref: null, required: true }, { ref: refOf('engine'), required: false }]);
    return engineFiles;
  };
  let lastGlob: ClassifyRules | null | undefined;
  const lastGlobCfg = (): ClassifyRules => {
    if (lastGlob === undefined) {
      lastGlob = null;
      for (const sha of commitsTouching('config/release.json')) {
        const text = showFile(sha, 'config/release.json');
        if (text === null) continue;
        const at = parseClassifyRules(text);
        if (at.engineEntries === undefined) {
          lastGlob = at;
          break;
        }
      }
    }
    return lastGlob ?? cfg;
  };
  const parentCfgs = new Map<string, ClassifyRules>();
  const cfgFor = (k: Commit): ClassifyRules => {
    const text = showFile(`${k.sha}^`, 'config/release.json');
    if (text !== null) {
      if (!parentCfgs.has(text)) parentCfgs.set(text, parseClassifyRules(text));
      const atParent = parentCfgs.get(text)!;
      if (atParent.engineEntries !== undefined) return atParent;
    }
    return lastGlobCfg();
  };
  const classified = new Map<string, Set<Component>>();
  const componentsOf = (k: Commit): Set<Component> => {
    if (!classified.has(k.sha)) {
      const at = cfgFor(k);
      classified.set(k.sha, componentsFor(k, at, at.engineEntries === undefined ? undefined : graphFor(at)));
    }
    return classified.get(k.sha)!;
  };
  const byComponent = new Map<Component, Commit[]>();
  for (const c of COMPONENTS) {
    byComponent.set(c, commitsSince(refOf(c)).filter((k) => componentsOf(k).has(c)));
  }

  // Fixture gate: a changed fingerprint under an unchanged engine major means the maps changed.
  let engineOutputChanged = false;
  // Judged against the file at the last engine release, so a rewritten fingerprint file cannot hide a changed map.
  const engineRef = refOf('engine');
  const recorded = readFingerprintFileAt(engineRef);
  if (Object.keys(recorded.states).length === 0) {
    console.log(`${FINGERPRINT_PATH} recorded no fixture states at ${engineRef}; the fixture gate is vacuous`);
  } else {
    const result = compareFingerprints(recorded, readFingerprintFile(), drawFingerprints(Object.keys(recorded.states), args.cacheDir), Number(current.engine.split('.')[0]));
    console.log(result.message);
    engineOutputChanged = !result.ok;
  }

  const inputSha256 = inputSha256Of(readText('config/census-sha256.json'), readText('config/enacted.json'), readText('config/legislative-districts.json'));
  // Published hashes that moved since the last maps release (a republish) need a maps release even with no engine bump.
  const mapsRef = newest.maps;
  // Data stamped with the Maps release that is already declared (the tag's number equals the current one) is covered.
  const taggedMaps = mapsRef === null ? null : Number(/^maps-(\d+)$/.exec(mapsRef)?.[1]);
  const dataChanged =
    mapsRef !== null && mapsDataChanged(showFile(mapsRef, 'public/data/index.json'), showFile('HEAD', 'public/data/index.json'), taggedMaps === null ? undefined : { base: taggedMaps, head: current.maps });
  const { next, reasons } = proposeVersions(current, { byComponent, engineOutputChanged, inputSha256, mapsDataChanged: dataChanged, tagged: taggedVersions(newest) });
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
    writeFileSync(path, prependEntry(readText(path), identityOf(next, c), date, lines.length > 0 ? lines : [NO_COMMITS[c]]));
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
