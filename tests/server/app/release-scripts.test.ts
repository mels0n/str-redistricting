import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { COMPONENTS } from '../../../src/server/features/release/index.js';
import { VERSIONS, formatVersions, parseFingerprintArgs, parseReleaseTagsArgs, parseVersionCheckArgs } from '../../../src/server/shared/config/index.js';
import { ConfigError } from '../../../src/server/shared/errors/index.js';

const appDir = fileURLToPath(new URL('../../../src/server/app/', import.meta.url));
// `--import tsx` resolves from the working directory, which is a temp repo with no node_modules, so name tsx by URL.
const tsx = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;
const releaseJson = readFileSync('config/release.json', 'utf8');
// The release scripts redraw every state a fingerprint file records; these tests are about versions, not maps.
const noFixtures = `${JSON.stringify({ engineMajor: 1, states: {} })}\n`;

let repo: string;
beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'release-scripts-'));
  git('init', '-q', '-b', 'main');
  // The scripts commit through plain git, which needs an identity in the temp repo.
  git('config', 'user.name', 't');
  git('config', 'user.email', 't@example.com');
  git('config', 'commit.gpgsign', 'false');
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

function git(...args: string[]): string {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd: repo, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}
function write(path: string, text: string): void {
  mkdirSync(dirname(join(repo, path)), { recursive: true });
  writeFileSync(join(repo, path), text);
}
function commitAll(message: string): string {
  git('add', '.');
  git('commit', '-q', '-m', message);
  return git('rev-parse', 'HEAD');
}
function run(script: string, args: string[]): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, ['--import', tsx, join(appDir, script), ...args], { cwd: repo, encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}
function seed(enforce: boolean): string {
  write('config/versions.json', formatVersions(VERSIONS));
  write('config/release.json', JSON.stringify({ ...JSON.parse(releaseJson), enforce }));
  for (const c of COMPONENTS) write(`changelog/${c}.md`, `# ${c} changelog\n\n`);
  return commitAll('chore: baseline');
}

describe('release:tags', () => {
  it('prints the six baseline tags for a root commit', () => {
    const first = seed(true);
    const out = run('release-tags.ts', ['--before', 'none', '--after', first]);
    expect(out.status).toBe(0);
    expect(out.stdout.trim().split(String.fromCharCode(10))).toEqual(['engine-v1.0.0', 'input-census-2020-r1', 'maps-1', 'schema-v1.0.0', 'web-v1.0.0', 'docs-v1.0.0']);
  });
  it('prints nothing when the before commit has no versions file (the cut has not happened yet)', () => {
    write('README.md', 'x');
    const parent = commitAll('chore: first');
    const child = seed(true);
    const out = run('release-tags.ts', ['--before', parent, '--after', child]);
    expect(out.status).toBe(0);
    expect(out.stdout.trim()).toBe('');
  });
  it('prints nothing at all while release.json does not enforce, even for a root commit', () => {
    const first = seed(false);
    expect(run('release-tags.ts', ['--before', 'none', '--after', first]).stdout.trim()).toBe('');
  });
  it('prints maps-2 when only the maps release changed', () => {
    const first = seed(true);
    write('config/versions.json', formatVersions({ ...VERSIONS, maps: 2 }));
    const second = commitAll('release: maps 2');
    const out = run('release-tags.ts', ['--before', first, '--after', second]);
    expect(out.status).toBe(0);
    expect(out.stdout.trim()).toBe('maps-2');
  });
  it('prints nothing when no version changed, and fails when the after commit has no versions file', () => {
    const first = seed(true);
    write('notes.txt', 'x');
    const second = commitAll('chore: notes');
    expect(run('release-tags.ts', ['--before', first, '--after', second]).stdout.trim()).toBe('');
    write('a.txt', 'x');
    git('rm', '-q', '-r', 'config');
    const third = commitAll('chore: drop config');
    expect(run('release-tags.ts', ['--before', second, '--after', third]).status).not.toBe(0);
  });
  it('rejects malformed arguments', () => {
    expect(run('release-tags.ts', ['--before', 'none', '--after', '--evil']).status).not.toBe(0);
    expect(run('release-tags.ts', []).status).not.toBe(0);
  });
});

function indexJson(assignment: string, input = 'i'): string {
  return JSON.stringify({ states: [{ abbr: 'CO', name: 'Colorado', summary: { assignmentSha256: assignment, inputSha256: input } }] });
}
/** An index whose one state carries a version stamp for the given Maps release. */
/** A stamp like publish writes: the maps release, and the engine and input revision that drew the map. */
function stampedIndexJson(assignment: string, maps: number, input = 'i', engine = maps >= 2 ? '2.0.0' : '1.0.0'): string {
  const versions = { engine, input: { vintage: 'census-2020', revision: 1, sha256: VERSIONS.input.sha256 }, maps, schema: '1.0.0' };
  return JSON.stringify({ states: [{ abbr: 'CO', name: 'Colorado', summary: { assignmentSha256: assignment, inputSha256: input, versions } }] });
}
/** seed() plus a published public/data/index.json, so version-check has hashes to compare. */
function seedWithData(enforce: boolean): string {
  write('public/data/index.json', indexJson('a'));
  write('public/data/CO/og.png', 'png');
  return seed(enforce);
}

describe('version:check', () => {
  it('warns and exits 0 when the published hashes change without a maps bump (enforce false)', () => {
    const base = seedWithData(false);
    write('public/data/index.json', indexJson('b'));
    commitAll('fix: redraw');
    const out = run('version-check.ts', ['--base', base]);
    expect(out.status).toBe(0);
    expect(out.stdout).toMatch(/::warning::maps: the published assignment or input hashes .* but maps was not bumped/);
  });
  it('exits 1 with an error line when enforce is true', () => {
    const base = seedWithData(true);
    write('public/data/index.json', indexJson('b'));
    commitAll('fix: redraw');
    const out = run('version-check.ts', ['--base', base]);
    expect(out.status).toBe(1);
    expect(out.stdout).toMatch(/::error::maps: the published assignment or input hashes/);
  });
  it('passes when the hashes changed and maps is bumped, with no engine or input bump', () => {
    const base = seedWithData(true);
    write('public/data/index.json', indexJson('b'));
    write('config/versions.json', formatVersions({ ...VERSIONS, maps: 2 }));
    commitAll('fix: redraw');
    const out = run('version-check.ts', ['--base', base]);
    expect(out.status).toBe(0);
    expect(out.stdout).toContain('version-check: ok');
  });
  it('passes a republish stamped with the Maps release an earlier change already declared (enforce true)', () => {
    seedWithData(true);
    write('config/versions.json', formatVersions({ ...VERSIONS, engine: '2.0.0', maps: 2 }));
    write('changelog/engine.md', '# engine changelog\n\n## 2.0.0\n\n- x\n');
    const base = commitAll('release: engine 2.0.0, maps 2');
    write('public/data/index.json', stampedIndexJson('b', 2));
    commitAll('fix: republish CO');
    const out = run('version-check.ts', ['--base', base]);
    expect(out.status, out.stdout).toBe(0);
    expect(out.stdout).toContain('version-check: ok');
  });
  it('still requires a maps bump when the republished stamps carry an old maps number', () => {
    seedWithData(true);
    write('config/versions.json', formatVersions({ ...VERSIONS, engine: '2.0.0', maps: 2 }));
    const base = commitAll('release: engine 2.0.0, maps 2');
    write('public/data/index.json', stampedIndexJson('b', 1));
    commitAll('fix: republish CO');
    const out = run('version-check.ts', ['--base', base]);
    expect(out.status).toBe(1);
    expect(out.stdout).toMatch(/::error::maps: the published assignment or input hashes/);
  });
  it('does not need a maps bump for data files that are not assignments (og images, tiles)', () => {
    const base = seedWithData(true);
    write('public/data/CO/og.png', 'png2');
    write('public/data/CO/blocks.pmtiles', 'tiles');
    commitAll('feat: tiles');
    expect(run('version-check.ts', ['--base', base]).status).toBe(0);
  });
  it('flags a maps bump with unchanged hashes unless the engine or input moved', () => {
    const base = seedWithData(true);
    write('config/versions.json', formatVersions({ ...VERSIONS, maps: 2 }));
    commitAll('chore: bump maps');
    const out = run('version-check.ts', ['--base', base]);
    expect(out.status).toBe(1);
    expect(out.stdout).toMatch(/::error::maps: bumped in config\/versions.json but the published assignment and input hashes did not change/);
  });
  it('reads config/release.json from the base, so a pull request cannot loosen enforcement', () => {
    const base = seedWithData(true);
    write('public/data/index.json', indexJson('b'));
    write('config/release.json', JSON.stringify({ ...JSON.parse(releaseJson), enforce: false }));
    commitAll('fix: redraw and relax');
    const out = run('version-check.ts', ['--base', base]);
    expect(out.status).toBe(1);
    expect(out.stdout).toContain('::error::');
  });
  it('ignores a file that was changed and put back inside the pull request', () => {
    const base = seedWithData(true);
    write('src/client/a.ts', 'one');
    commitAll('feat: a');
    git('rm', '-q', 'src/client/a.ts');
    commitAll('revert: a');
    expect(run('version-check.ts', ['--base', base]).status).toBe(0);
  });
  it('notes and exits 0 when the base has no versions file', () => {
    write('README.md', 'x');
    const base = commitAll('chore: first');
    seed(true);
    const out = run('version-check.ts', ['--base', base]);
    expect(out.status).toBe(0);
    expect(out.stdout).toContain('::notice::');
  });
  it('fails clearly when the branch shares no history with the base', () => {
    const base = seed(true);
    git('checkout', '-q', '--orphan', 'island');
    write('README.md', 'island');
    commitAll('chore: island');
    const out = run('version-check.ts', ['--base', base]);
    expect(out.status).not.toBe(0);
    expect(out.stderr).toContain(`no common history with ${base}; rebase this branch onto ${base}`);
  });
  it('needs --base', () => {
    seed(false);
    expect(run('version-check.ts', []).status).not.toBe(0);
  });
});

describe('release', () => {
  it('says there are no tags yet and exits 0', () => {
    seed(false);
    const out = run('release.ts', ['--dry-run']);
    expect(out.status).toBe(0);
    expect(out.stdout).toContain('no release tags yet; versions are the 1.0 baseline');
  });
  it('proposes a web minor for a feat since the tags, and writes nothing on --dry-run', () => {
    seed(false);
    write('tests/fingerprints/engine.json', noFixtures);
    write('config/census-sha256.json', readFileSync('config/census-sha256.json', 'utf8'));
    write('config/enacted.json', readFileSync('config/enacted.json', 'utf8'));
    commitAll('chore: inputs');
    for (const tag of ['engine-v1.0.0', 'input-census-2020-r1', 'maps-1', 'schema-v1.0.0', 'web-v1.0.0', 'docs-v1.0.0']) git('tag', tag);
    write('src/client/a.ts', 'x');
    commitAll('feat: a client thing');
    const out = run('release.ts', ['--dry-run']);
    expect(out.status, out.stderr).toBe(0);
    expect(out.stdout).toContain('release: web 1.1.0');
    expect(git('status', '--porcelain')).toBe('');
    expect(readFileSync(join(repo, 'config/versions.json'), 'utf8')).toBe(formatVersions(VERSIONS));
  });
});

describe('release (repeat runs and measuring)', () => {
  const baselineTags = ['engine-v1.0.0', 'input-census-2020-r1', 'maps-1', 'schema-v1.0.0', 'web-v1.0.0', 'docs-v1.0.0'];
  function tagged(withData = false): void {
    if (withData) {
      write('public/data/index.json', indexJson('a'));
    }
    seed(false);
    write('tests/fingerprints/engine.json', noFixtures);
    for (const f of ['config/census-sha256.json','config/enacted.json']) write(f, readFileSync(f, 'utf8'));
    commitAll('chore: inputs');
    for (const tag of baselineTags) git('tag', tag);
  }
  const head = (): string => git('rev-parse', 'HEAD');

  it('changes nothing the second time it runs', () => {
    tagged();
    write('src/client/a.ts', 'x');
    commitAll('feat: a client thing');
    expect(run('release.ts', []).status).toBe(0);
    const after = head();
    const versions = readFileSync(join(repo, 'config/versions.json'), 'utf8');
    expect(versions).toContain('"web": "1.1.0"');
    const again = run('release.ts', []);
    expect(again.status, again.stderr).toBe(0);
    expect(again.stdout).toContain('nothing to release');
    expect(head()).toBe(after);
    expect(readFileSync(join(repo, 'config/versions.json'), 'utf8')).toBe(versions);
  });
  it('escalates a patch release to a minor when a feat follows, and is idempotent afterwards', () => {
    tagged();
    write('src/client/a.ts', 'x');
    commitAll('fix: a client fix');
    expect(run('release.ts', []).status).toBe(0);
    expect(readFileSync(join(repo, 'config/versions.json'), 'utf8')).toContain('"web": "1.0.1"');
    write('src/client/b.ts', 'y');
    commitAll('feat: a client thing');
    const second = run('release.ts', []);
    expect(second.status, second.stderr).toBe(0);
    expect(readFileSync(join(repo, 'config/versions.json'), 'utf8')).toContain('"web": "1.1.0"');
    const after = head();
    const again = run('release.ts', []);
    expect(again.status, again.stderr).toBe(0);
    expect(again.stdout).toContain('nothing to release');
    expect(head()).toBe(after);
  });
  it('measures each component from its newest tag', () => {
    tagged();
    write('src/client/a.ts', 'x');
    commitAll('feat: a client thing');
    expect(run('release.ts', []).status).toBe(0);
    git('tag', 'web-v1.1.0');
    write('src/client/b.ts', 'y');
    commitAll('fix: a client fix');
    const out = run('release.ts', ['--dry-run']);
    expect(out.status, out.stderr).toBe(0);
    expect(out.stdout).toContain('release: web 1.1.1');
    expect(out.stdout).not.toContain('web 1.2.0');
  });
  it('bumps maps when the published hashes changed since the maps tag', () => {
    tagged(true);
    write('public/data/index.json', indexJson('b'));
    commitAll('fix: republish CO');
    const out = run('release.ts', ['--dry-run']);
    expect(out.status, out.stderr).toBe(0);
    expect(out.stdout).toContain('release: maps 2');
  });
  it('proposes nothing for a republish stamped with the Maps release already declared and tagged', () => {
    tagged(true);
    write('config/versions.json', formatVersions({ ...VERSIONS, engine: '2.0.0', maps: 2 }));
    commitAll('release: engine 2.0.0, maps 2');
    git('tag', 'engine-v2.0.0');
    git('tag', 'maps-2');
    write('public/data/index.json', stampedIndexJson('b', 2));
    commitAll('fix: republish CO');
    const out = run('release.ts', ['--dry-run']);
    expect(out.status, out.stderr).toBe(0);
    expect(out.stdout).toContain('nothing to release');
  });
  it('still proposes maps for a republish whose stamps carry an older maps number', () => {
    tagged(true);
    write('config/versions.json', formatVersions({ ...VERSIONS, engine: '2.0.0', maps: 2 }));
    commitAll('release: engine 2.0.0, maps 2');
    git('tag', 'engine-v2.0.0');
    git('tag', 'maps-2');
    write('public/data/index.json', stampedIndexJson('b', 1));
    commitAll('fix: republish CO');
    const out = run('release.ts', ['--dry-run']);
    expect(out.status, out.stderr).toBe(0);
    expect(out.stdout).toContain('release: maps 3');
  });
  it('leaves maps alone when only non-assignment data files changed', () => {
    tagged(true);
    write('public/data/CO/og.png', 'png');
    commitAll('feat: og image');
    expect(run('release.ts', ['--dry-run']).stdout).toContain('nothing to release');
  });
});

describe('fingerprints --check --base', () => {
  const empty = `${JSON.stringify({ engineMajor: 1, states: {} })}
`;
  it('passes vacuously when the base ref has no fingerprint file, whatever the head file says', () => {
    const base = seed(false);
    write('tests/fingerprints/engine.json', `${JSON.stringify({ engineMajor: 1, states: { RI: { before: 'a'.repeat(64), finished: 'b'.repeat(64) } } })}
`);
    commitAll('chore: record');
    const out = run('fingerprints.ts', ['--check', '--base', base]);
    expect(out.status, out.stderr).toBe(0);
    expect(out.stdout).toContain('::notice::');
  });
  it('passes vacuously when the base file records no states', () => {
    seed(false);
    write('tests/fingerprints/engine.json', empty);
    const base = commitAll('chore: empty fingerprints');
    write('notes.txt', 'x');
    commitAll('chore: notes');
    expect(run('fingerprints.ts', ['--check', '--base', base]).status).toBe(0);
  });
});

describe('script argument parsers', () => {
  it('parse and reject', () => {
    expect(parseVersionCheckArgs(['--base', 'origin/main'])).toEqual({ base: 'origin/main' });
    expect(() => parseVersionCheckArgs([])).toThrow(ConfigError);
    expect(() => parseVersionCheckArgs(['--base=--upload-pack=x'])).toThrow(ConfigError);
    expect(parseReleaseTagsArgs(['--before', 'none', '--after', 'abcdef1'])).toEqual({ before: 'none', after: 'abcdef1' });
    expect(() => parseReleaseTagsArgs(['--before', 'none'])).toThrow(ConfigError);
    expect(() => parseReleaseTagsArgs(['--before', '--output=x', '--after', 'abcdef1'])).toThrow(ConfigError);
    expect(() => parseReleaseTagsArgs(['--before=--output=x', '--after', 'abcdef1'])).toThrow(ConfigError);
    expect(() => parseReleaseTagsArgs(['--before', 'none', '--after=-abcdef1'])).toThrow(ConfigError);
    expect(parseFingerprintArgs(['--check'])).toEqual({ mode: 'check', states: undefined, cacheDir: 'data/raw' });
    expect(parseFingerprintArgs(['--record', '--states', 'RI,DE']).states).toEqual(['RI', 'DE']);
    expect(parseFingerprintArgs(['--check', '--base', 'origin/main']).base).toBe('origin/main');
    expect(parseFingerprintArgs(['--check', '--base', 'HEAD^']).base).toBe('HEAD^');
    expect(() => parseFingerprintArgs(['--check', '--base=--evil'])).toThrow(ConfigError);
    expect(() => parseFingerprintArgs(['--record', '--base', 'main'])).toThrow(ConfigError);
    expect(() => parseFingerprintArgs([])).toThrow(ConfigError);
    expect(() => parseFingerprintArgs(['--check', '--record'])).toThrow(ConfigError);
    expect(() => parseFingerprintArgs(['--check', '--states', 'ZZ'])).toThrow(ConfigError);
  });
});
