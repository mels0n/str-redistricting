import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { engineFilesAt } from '../../../src/server/app/git.js';
import { ReleaseConfigSchema } from '../../../src/server/features/release/index.js';
import { DataError } from '../../../src/server/shared/errors/index.js';

let repo: string;
const git = (...args: string[]): void => {
  const r = spawnSync('git', args, { cwd: repo });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed`);
};
const write = (path: string, text: string): void => {
  mkdirSync(dirname(join(repo, path)), { recursive: true });
  writeFileSync(join(repo, path), text);
};
const commitAll = (msg: string): void => { git('add', '-A'); git('commit', '-q', '-m', msg); };
const cfg = (engineEntries?: string[]) => ReleaseConfigSchema.parse({
  enforce: true, paths: { engine: [], input: [], maps: [], schema: [], web: [], docs: [] },
  exclude: { engine: [], input: [], maps: [], schema: [], web: [], docs: [] },
  ...(engineEntries === undefined ? {} : { engineEntries }), ignore: [], docsTypes: [], fixtureStates: ['VT'],
});

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'engine-files-'));
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 't');
  git('config', 'user.email', 't@example.com');
  write('package-lock.json', JSON.stringify({ packages: {} }));
  write('src/server/app/cli.ts', "import './a.js';\nimport './old.js';\n");
  write('src/server/app/a.ts', 'export {};\n');
  write('src/server/app/old.ts', 'export {};\n');
  write('src/server/app/other.ts', 'export {};\n');
  commitAll('base');
});
afterEach(() => { rmSync(repo, { recursive: true, force: true }); });

describe('engineFilesAt', () => {
  it('is undefined without engineEntries, so the globs stay in force', () => {
    expect(engineFilesAt(cfg(), [null], repo)).toBeUndefined();
  });
  it('unions the graph at the base ref (from its commit) with the working tree', () => {
    git('rm', '-q', 'src/server/app/old.ts');
    write('src/server/app/cli.ts', "import './a.js';\nimport './fresh.js';\n");
    write('src/server/app/fresh.ts', 'export {};\n');
    commitAll('change');
    const files = [...engineFilesAt(cfg(['src/server/app/cli.ts']), ['HEAD~1', null], repo)!].sort();
    expect(files).toEqual(['src/server/app/a.ts', 'src/server/app/cli.ts', 'src/server/app/fresh.ts', 'src/server/app/old.ts']);
  });
  it('reads a ref from its commit, not the working tree, and skips an entry missing there', () => {
    write('src/server/app/cli.ts', 'export {};\n');
    expect([...engineFilesAt(cfg(['src/server/app/cli.ts']), ['HEAD'], repo)!].sort()).toEqual(['src/server/app/a.ts', 'src/server/app/cli.ts', 'src/server/app/old.ts']);
    const sha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).stdout.trim();
    expect(engineFilesAt(cfg(['src/server/app/nope.ts']), [sha, null].slice(0, 1), repo)!.size).toBe(0);
  });
});

describe('the engine entry in config/release.json', () => {
  it('names the file the explore code fingerprint starts from, and that file exists', () => {
    const real = ReleaseConfigSchema.parse(JSON.parse(readFileSync('config/release.json', 'utf8')));
    expect(real.engineEntries).toEqual(['src/server/app/cli.ts']);
    expect(existsSync(real.engineEntries![0]!)).toBe(true);
    // run-key.ts is part of the code fingerprint, so it is read, not edited: its entry must be this same file.
    expect(readFileSync('src/server/app/run-key.ts', 'utf8')).toContain("new URL('./cli.ts', import.meta.url)");
    expect(resolve(real.engineEntries![0]!)).toBe(fileURLToPath(new URL('../../../src/server/app/cli.ts', import.meta.url)));
  });
  it('fails loudly, rather than switching the engine off, when no entry exists at HEAD or in the working tree', () => {
    expect(() => engineFilesAt(cfg(['src/server/app/nope.ts']), [null], repo)).toThrow(DataError);
    expect(() => engineFilesAt(cfg(['src/server/app/nope.ts']), ['HEAD'], repo)).toThrow(DataError);
  });
  it('rejects glob engine rules next to engineEntries', () => {
    expect(() => ReleaseConfigSchema.parse({ ...cfg(['src/server/app/cli.ts']), paths: { engine: ['src/server/**'], input: [], maps: [], schema: [], web: [], docs: [] } })).toThrow();
  });
  it('fails on a ref that is not a commit', () => {
    expect(() => engineFilesAt(cfg(['src/server/app/cli.ts']), ['nonexistent-ref', null], repo)).toThrow(DataError);
  });
});
