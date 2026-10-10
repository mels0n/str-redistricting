import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearStamp, codeFingerprint, codeInputs, drawOrSkip, RunStampSchema, STAMP_FILE, staleReason, writeStamp, type RunKey } from '../../../src/server/features/run-stamp/index.js';
import { DataError } from '../../../src/server/shared/errors/index.js';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'run-stamp-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const sha = (text: string): string => createHash('sha256').update(text).digest('hex');
const key: RunKey = { inputSha256: 'a'.repeat(64), seats: 8, engineMajor: '1', codeSha256: 'c'.repeat(64) };

describe('staleReason', () => {
  async function drawn(paths = ['metrics.json', 'before-balancing/metrics.json']): Promise<void> {
    for (const f of paths) {
      mkdirSync(join(dir, f, '..'), { recursive: true });
      writeFileSync(join(dir, f), '{}');
    }
    await writeStamp(dir, { ...key, files: paths.map((path) => ({ path, sha256: sha('{}') })) });
  }

  it('redraws a folder with no stamp', async () => {
    expect(await staleReason(dir, key)).toBe('no complete earlier run');
  });
  it('skips a folder drawn from the same key', async () => {
    await drawn();
    expect(await staleReason(dir, key)).toBeUndefined();
    expect(readdirSync(dir).filter((f) => f.endsWith('.part'))).toEqual([]);
  });
  it('names what changed', async () => {
    await drawn();
    expect(await staleReason(dir, { ...key, inputSha256: 'b'.repeat(64) })).toBe('census file changed');
    expect(await staleReason(dir, { ...key, seats: 9 })).toBe('seat count changed');
    expect(await staleReason(dir, { ...key, engineMajor: '2' })).toBe('engine major changed');
    expect(await staleReason(dir, { ...key, codeSha256: 'd'.repeat(64) })).toBe('code changed');
  });
  it('redraws when a file the run wrote is gone', async () => {
    await drawn();
    rmSync(join(dir, 'before-balancing', 'metrics.json'));
    expect(await staleReason(dir, key)).toBe('before-balancing/metrics.json is missing');
  });
  it('redraws when a file the run wrote was changed or cut short', async () => {
    await drawn();
    writeFileSync(join(dir, 'before-balancing', 'metrics.json'), '{');
    expect(await staleReason(dir, key)).toBe('before-balancing/metrics.json changed');
  });
  it('refuses a stamp listing no files or a path outside the folder', () => {
    const file = { path: 'metrics.json', sha256: sha('{}') };
    expect(RunStampSchema.safeParse({ ...key, files: [file] }).success).toBe(true);
    expect(RunStampSchema.safeParse({ ...key, files: [] }).success).toBe(false);
    expect(RunStampSchema.safeParse({ ...key, files: [{ ...file, path: '../x.json' }] }).success).toBe(false);
    expect(RunStampSchema.safeParse({ ...key, files: [{ ...file, path: '/x.json' }] }).success).toBe(false);
  });
  it('treats an unreadable stamp as no run', async () => {
    writeFileSync(join(dir, STAMP_FILE), '{ not json');
    expect(await staleReason(dir, key)).toBe('no complete earlier run');
  });
  it('clearStamp leaves a folder that is redrawn', async () => {
    await drawn();
    await clearStamp(dir);
    expect(await staleReason(dir, key)).toBe('no complete earlier run');
    await clearStamp(join(dir, 'never-made'));
  });
});

describe('drawOrSkip', () => {
  const writeDir = async (d: string, files: Record<string, string>): Promise<void> => {
    await mkdir(d, { recursive: true });
    for (const [name, text] of Object.entries(files)) await writeFile(join(d, name), text);
  };
  const plans = async (write: (sub: string, files: Record<string, string>) => Promise<void>, text = 'a'): Promise<void> => {
    await write('before-balancing', { 'assignment.csv': text, 'metrics.json': '{}' });
    await write('', { 'assignment.csv': text, 'metrics.json': '{}' });
    await write('', { 'balance.json': '[]' });
  };

  it('stamps every file written, with its folder and hash, and skips the next run', async () => {
    const reasons: string[] = [];
    const opts = { dir, key, force: false, writeDir, onDraw: (why: string) => reasons.push(why) };
    expect(await drawOrSkip(opts, (w) => plans(w))).toBe('drawn');
    const stamp = RunStampSchema.parse(JSON.parse(readFileSync(join(dir, STAMP_FILE), 'utf8')));
    expect(stamp.files.map((f) => f.path).sort()).toEqual(['assignment.csv', 'balance.json', 'before-balancing/assignment.csv', 'before-balancing/metrics.json', 'metrics.json']);
    expect(stamp.files.find((f) => f.path === 'balance.json')?.sha256).toBe(sha('[]'));
    let ran = false;
    expect(await drawOrSkip(opts, async () => { ran = true; })).toBe('skipped');
    expect(ran).toBe(false);
    expect(reasons).toEqual(['no complete earlier run']);
  });
  it('draws again with force, and with no stamp on disk while it draws', async () => {
    await drawOrSkip({ dir, key, force: false, writeDir }, (w) => plans(w));
    const reasons: string[] = [];
    let stampDuringDraw = true;
    const got = await drawOrSkip({ dir, key, force: true, writeDir, onDraw: (why) => reasons.push(why) }, async (w) => {
      stampDuringDraw = existsSync(join(dir, STAMP_FILE));
      await plans(w, 'b');
    });
    expect(got).toBe('drawn');
    expect(reasons).toEqual(['--force']);
    expect(stampDuringDraw).toBe(false);
    expect(await staleReason(dir, key)).toBeUndefined();
  });
  it('leaves no stamp when the draw fails partway', async () => {
    await drawOrSkip({ dir, key, force: false, writeDir }, (w) => plans(w));
    await expect(drawOrSkip({ dir, key: { ...key, seats: 9 }, force: false, writeDir }, async (w) => {
      await w('', { 'assignment.csv': 'partial' });
      throw new Error('worker died');
    })).rejects.toThrow('worker died');
    expect(existsSync(join(dir, STAMP_FILE))).toBe(false);
    expect(await staleReason(dir, key)).toBe('no complete earlier run');
  });
});

describe('codeFingerprint', () => {
  function project(): string {
    writeFileSync(join(dir, 'package-lock.json'), JSON.stringify({
      lockfileVersion: 3,
      packages: {
        '': { name: 'p' },
        'node_modules/lib': { version: '1.0.0', integrity: 'sha-lib', dependencies: { dep: '^2' } },
        'node_modules/dep': { version: '2.0.0', integrity: 'sha-dep' },
        'node_modules/unused': { version: '9.0.0', integrity: 'sha-unused' },
      },
    }));
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'main.ts'), [
      "import { readFile } from 'node:fs';",
      "import cfg from '../config.json' with { type: 'json' };",
      "import lib from 'lib/sub';",
      "export { b } from './b.js';",
    ].join('\n'));
    writeFileSync(join(dir, 'src', 'b.ts'), "export const b = 1;\nconst w = new URL(ts ? './worker.ts' : './worker.js', import.meta.url);\n");
    writeFileSync(join(dir, 'src', 'worker.ts'), 'export {};\n');
    writeFileSync(join(dir, 'src', 'other.ts'), 'export {};\n');
    writeFileSync(join(dir, 'config.json'), '{}');
    return join(dir, 'src', 'main.ts');
  }

  it('covers imports, worker scripts and installed packages, not JSON config or unrelated files', () => {
    const got = codeInputs([project()], dir);
    expect(got.files.map((f) => relative(dir, f).split('\\').join('/')).sort()).toEqual(['src/b.ts', 'src/main.ts', 'src/worker.ts']);
    expect(got.packages).toEqual(['node_modules/dep 2.0.0 sha-dep', 'node_modules/lib 1.0.0 sha-lib']);
  });
  it('changes with a reached file or a dependency, not with an unrelated file, JSON config or line endings', () => {
    const main = project();
    const base = codeFingerprint([main], dir);
    writeFileSync(join(dir, 'src', 'other.ts'), 'export const x = 2;\n');
    writeFileSync(join(dir, 'config.json'), '{"a":1}');
    writeFileSync(join(dir, 'src', 'worker.ts'), 'export {};\r\n');
    expect(codeFingerprint([main], dir)).toBe(base);
    writeFileSync(join(dir, 'src', 'worker.ts'), 'export const y = 1;\n');
    const edited = codeFingerprint([main], dir);
    expect(edited).not.toBe(base);
    const lock = JSON.parse('{"lockfileVersion":3,"packages":{"":{},"node_modules/lib":{"version":"1.0.0","integrity":"sha-lib","dependencies":{"dep":"^2"}},"node_modules/dep":{"version":"2.0.1","integrity":"sha-dep2"}}}') as unknown;
    writeFileSync(join(dir, 'package-lock.json'), JSON.stringify(lock));
    expect(codeFingerprint([main], dir)).not.toBe(edited);
  });
  it('finds a nested install before a hoisted one', () => {
    const main = project();
    writeFileSync(join(dir, 'package-lock.json'), JSON.stringify({
      lockfileVersion: 3,
      packages: {
        'node_modules/lib': { version: '1.0.0', dependencies: { dep: '^3' } },
        'node_modules/lib/node_modules/dep': { version: '3.0.0' },
        'node_modules/dep': { version: '2.0.0' },
      },
    }));
    expect(codeInputs([main], dir).packages).toEqual(['node_modules/lib 1.0.0 ', 'node_modules/lib/node_modules/dep 3.0.0 ']);
  });
});

describe('codeInputs packages', () => {
  function withLock(lock: unknown, main: string): string {
    writeFileSync(join(dir, 'package-lock.json'), typeof lock === 'string' ? lock : JSON.stringify(lock));
    const file = join(dir, 'main.ts');
    writeFileSync(file, main);
    return file;
  }
  it('follows optional and peer dependencies and records a package with no install', () => {
    const main = withLock({
      lockfileVersion: 3,
      packages: {
        'node_modules/lib': { version: '1.0.0', optionalDependencies: { opt: '*' }, peerDependencies: { peer: '*' } },
        'node_modules/opt': { version: '2.0.0' },
        'node_modules/peer': { version: '3.0.0' },
      },
    }, "import a from 'lib';\nimport b from '@scope/ghost/sub';\n");
    expect(codeInputs([main], dir).packages).toEqual(['@scope/ghost missing', 'node_modules/lib 1.0.0 ', 'node_modules/opt 2.0.0 ', 'node_modules/peer 3.0.0 ']);
  });
  it('fails with a DataError on a lockfile it cannot read', () => {
    const main = withLock('{ not json', "import a from 'lib';\n");
    expect(() => codeInputs([main], dir)).toThrow(DataError);
  });
});

describe('the explore code graph', () => {
  it('fingerprints the cut search worker and the drawing code, not publishing', () => {
    const root = resolve(import.meta.dirname, '../../..');
    const files = codeInputs([join(root, 'src/server/app/cli.ts')], root).files.map((f) => relative(root, f).split('\\').join('/'));
    expect(files).toContain('src/server/features/splitline/scan-worker.ts');
    expect(files).toContain('src/server/shared/apportionment/index.ts');
    expect(files).toContain('src/server/features/export/write.ts');
    expect(files.some((f) => f.startsWith('src/server/features/publish/'))).toBe(false);
    expect(files.some((f) => f.endsWith('.json'))).toBe(false);
  });
});
