import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import { dirname, relative, resolve } from 'node:path';
import { z } from 'zod';
import { DataError } from '../../shared/errors/index.js';

/** `from '…'`, `import '…'` and `import('…')`. */
const IMPORT_RE = /(?:\bfrom|\bimport)\s*\(?\s*['"]([^'"]+)['"]/g;
/** Any relative path to a script in a string literal, which is how a worker file is named (`new URL('./w.ts', …)`). */
const SCRIPT_PATH_RE = /['"](\.\.?\/[^'"]+\.(?:ts|js))['"]/g;

const LockSchema = z.object({
  packages: z.record(z.string(), z.looseObject({
    version: z.string().optional(),
    integrity: z.string().optional(),
    dependencies: z.record(z.string(), z.string()).optional(),
    optionalDependencies: z.record(z.string(), z.string()).optional(),
    peerDependencies: z.record(z.string(), z.string()).optional(),
  })),
});
type LockPackages = z.infer<typeof LockSchema>['packages'];

/** `@scope/name/sub` -> `@scope/name`, `name/sub` -> `name`. */
function packageName(spec: string): string {
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!;
}

/** The TypeScript file a relative specifier names: `./x.js` is `./x.ts` in source. Non-script files (JSON config) are data, not code. */
function resolveScript(fromFile: string, spec: string): string | undefined {
  const abs = resolve(dirname(fromFile), spec);
  const ts = abs.replace(/\.js$/, '.ts');
  if (ts.endsWith('.ts') && existsSync(ts)) return ts;
  return undefined;
}

/** Where npm installed `name` for the package at `from` (a lockfile key, '' for the project): nearest node_modules upward. */
function lockPath(packages: LockPackages, from: string, name: string): string | undefined {
  let base = from;
  for (;;) {
    const candidate = base ? `${base}/node_modules/${name}` : `node_modules/${name}`;
    if (packages[candidate]) return candidate;
    if (!base) return undefined;
    const i = base.lastIndexOf('/node_modules/');
    base = i >= 0 ? base.slice(0, i) : '';
  }
}

/** What a run executes: source files (absolute paths) and installed packages (`lockfile-key version integrity`). */
export interface CodeInputs {
  readonly files: string[];
  readonly packages: string[];
}

/**
 * Every TypeScript file reachable from `entries` through imports (and worker script paths), and every installed
 * package those files import, with that package's own dependencies. JSON config is not included: it is data, and
 * the parts of it that decide a map are keyed separately.
 */
export function codeInputs(entries: readonly string[], repoRoot: string): CodeInputs {
  const files = new Set<string>();
  const bare = new Set<string>();
  const queue = entries.map((e) => resolve(e));
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (files.has(file)) continue;
    files.add(file);
    const text = readFileSync(file, 'utf8');
    for (const re of [IMPORT_RE, SCRIPT_PATH_RE]) {
      for (const m of text.matchAll(re)) {
        const spec = m[1]!;
        if (spec.startsWith('.')) {
          const next = resolveScript(file, spec);
          if (next) queue.push(next);
        } else if (re === IMPORT_RE && !isBuiltin(spec)) {
          bare.add(packageName(spec));
        }
      }
    }
  }

  const lockFile = resolve(repoRoot, 'package-lock.json');
  let packages: LockPackages;
  try {
    packages = LockSchema.parse(JSON.parse(readFileSync(lockFile, 'utf8'))).packages;
  } catch {
    throw new DataError(`${lockFile}: could not read the installed package list`);
  }
  const installed = new Set<string>();
  const pending = [...bare].map((name) => ({ from: '', name }));
  while (pending.length > 0) {
    const { from, name } = pending.pop()!;
    const at = lockPath(packages, from, name);
    if (at === undefined) {
      installed.add(`${name} missing`);
      continue;
    }
    const entry = packages[at]!;
    const line = `${at} ${entry.version ?? ''} ${entry.integrity ?? ''}`;
    if (installed.has(line)) continue;
    installed.add(line);
    for (const deps of [entry.dependencies, entry.optionalDependencies, entry.peerDependencies]) {
      for (const dep of Object.keys(deps ?? {})) pending.push({ from: at, name: dep });
    }
  }

  return { files: [...files], packages: [...installed].sort() };
}

/** A fingerprint of codeInputs. Line endings are normalised, so a checkout with CRLF and one with LF agree. */
export function codeFingerprint(entries: readonly string[], repoRoot: string): string {
  const { files, packages } = codeInputs(entries, repoRoot);
  const hash = createHash('sha256');
  for (const file of files.map((f) => ({ f, rel: relative(repoRoot, f).split('\\').join('/') })).sort((a, b) => (a.rel < b.rel ? -1 : 1))) {
    hash.update(`${file.rel}\n`);
    hash.update(createHash('sha256').update(readFileSync(file.f, 'utf8').replace(/\r\n/g, '\n')).digest('hex'));
    hash.update('\n');
  }
  for (const line of packages) hash.update(`${line}\n`);
  return hash.digest('hex');
}
