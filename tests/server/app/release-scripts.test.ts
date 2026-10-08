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

let repo: string;
beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'release-scripts-'));
  git('init', '-q', '-b', 'main');
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
    const first = seed(false);
    const out = run('release-tags.ts', ['--before', 'none', '--after', first]);
    expect(out.status).toBe(0);
    expect(out.stdout.trim().split('\n')).toEqual(['engine-v1.0.0', 'input-census-2020-r1', 'maps-1', 'schema-v1.0.0', 'web-v1.0.0', 'docs-v1.0.0']);
  });
  it('treats a parent without the versions file as no previous versions', () => {
    write('README.md', 'x');
    const parent = commitAll('chore: first');
    const child = seed(false);
    expect(run('release-tags.ts', ['--before', parent, '--after', child]).stdout.trim().split('\n')).toHaveLength(6);
  });
  it('prints maps-2 when only the maps release changed', () => {
    const first = seed(false);
    write('config/versions.json', formatVersions({ ...VERSIONS, maps: 2 }));
    const second = commitAll('release: maps 2');
    const out = run('release-tags.ts', ['--before', first, '--after', second]);
    expect(out.status).toBe(0);
    expect(out.stdout.trim()).toBe('maps-2');
  });
  it('prints nothing when no version changed, and fails when the after commit has no versions file', () => {
    const first = seed(false);
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

describe('version:check', () => {
  it('warns and exits 0 when public/data changes without a maps bump (enforce false)', () => {
    const base = seed(false);
    write('public/data/CO/stats.json', '{}');
    commitAll('fix: redraw');
    const out = run('version-check.ts', ['--base', base]);
    expect(out.status).toBe(0);
    expect(out.stdout).toMatch(/::warning::maps: its files changed but maps was not bumped/);
  });
  it('exits 1 with an error line when enforce is true', () => {
    const base = seed(true);
    write('public/data/CO/stats.json', '{}');
    commitAll('fix: redraw');
    const out = run('version-check.ts', ['--base', base]);
    expect(out.status).toBe(1);
    expect(out.stdout).toMatch(/::error::maps: its files changed but maps was not bumped/);
  });
  it('passes when the touched component is bumped', () => {
    const base = seed(true);
    write('public/data/CO/stats.json', '{}');
    write('config/versions.json', formatVersions({ ...VERSIONS, maps: 2 }));
    commitAll('fix: redraw');
    // maps bumped alongside its files; the engine and input did not move, which is allowed (a data-only republish).
    const out = run('version-check.ts', ['--base', base]);
    expect(out.status).toBe(0);
    expect(out.stdout).toContain('version-check: ok');
  });
  it('ignores a file that was changed and put back inside the pull request', () => {
    const base = seed(true);
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
    write('tests/fingerprints/engine.json', readFileSync('tests/fingerprints/engine.json', 'utf8'));
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

describe('script argument parsers', () => {
  it('parse and reject', () => {
    expect(parseVersionCheckArgs(['--base', 'origin/main'])).toEqual({ base: 'origin/main' });
    expect(() => parseVersionCheckArgs([])).toThrow(ConfigError);
    expect(() => parseVersionCheckArgs(['--base=--upload-pack=x'])).toThrow(ConfigError);
    expect(parseReleaseTagsArgs(['--before', 'none', '--after', 'abcdef1'])).toEqual({ before: 'none', after: 'abcdef1' });
    expect(() => parseReleaseTagsArgs(['--before', 'none'])).toThrow(ConfigError);
    expect(parseFingerprintArgs(['--check'])).toEqual({ mode: 'check', states: undefined, cacheDir: 'data/raw' });
    expect(parseFingerprintArgs(['--record', '--states', 'RI,DE']).states).toEqual(['RI', 'DE']);
    expect(() => parseFingerprintArgs([])).toThrow(ConfigError);
    expect(() => parseFingerprintArgs(['--check', '--record'])).toThrow(ConfigError);
    expect(() => parseFingerprintArgs(['--check', '--states', 'ZZ'])).toThrow(ConfigError);
  });
});
