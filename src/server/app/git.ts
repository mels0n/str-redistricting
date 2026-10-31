import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { parseCommitSubject, type ClassifyRules, type Commit } from '../features/release/index.js';
import { codeInputs } from '../features/run-stamp/index.js';
import { ConfigError, DataError } from '../shared/errors/index.js';

/** Runs git in the current directory; returns stdout, or null when git exits non-zero. */
function tryGit(args: readonly string[]): string | null {
  const r = spawnSync('git', [...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.error !== undefined) throw new DataError(`could not run git: ${r.error.message}`);
  return r.status === 0 ? r.stdout : null;
}

/** A ref that git could read as an option (`--output=...`) is refused before it reaches a command line. */
function safeRef(ref: string): string {
  if (ref.startsWith('-')) throw new ConfigError(`${ref} is not a git ref (it starts with "-")`);
  return ref;
}

function git(args: readonly string[]): string {
  const out = tryGit(args);
  if (out === null) throw new DataError(`git ${args.join(' ')} failed`);
  return out;
}

/** The text of `path` at `ref`, or null when it does not exist there. */
export function showFile(ref: string, path: string): string | null {
  return tryGit(['show', '--end-of-options', `${safeRef(ref)}:${path}`]);
}

/** Every tag in the repository. */
export function listTags(): string[] {
  return git(['tag', '--list']).split('\n').filter(Boolean);
}

/** The best common ancestor of two refs, or null when they share no history. */
export function mergeBase(a: string, b: string): string | null {
  const out = tryGit(['merge-base', '--end-of-options', safeRef(a), safeRef(b)]);
  return out === null ? null : out.trim();
}

export function tagExists(tag: string): boolean {
  return tryGit(['rev-parse', '--verify', '--quiet', `refs/tags/${tag}`]) !== null;
}

/** Files that differ between the merge base of `base` and `head`, and `head`. */
export function changedFiles(base: string, head: string): string[] {
  return git(['diff', '--name-only', '--no-renames', '--end-of-options', `${safeRef(base)}...${safeRef(head)}`]).split('\n').filter(Boolean);
}

/** The commits reachable from HEAD and not from `ref` (all of them when `ref` is null), newest first, merges left out. */
export function commitsSince(ref: string | null): Commit[] {
  const range = ref === null ? ['HEAD'] : [`${safeRef(ref)}..HEAD`];
  const out = git(['log', '--no-merges', '--no-renames', '--name-only', '--format=%x1e%H%x1f%s', '--end-of-options', ...range]);
  return out
    .split('\x1e')
    .filter((chunk) => chunk.trim() !== '')
    .map((chunk) => {
      const [head, ...files] = chunk.split('\n');
      const [sha, subject] = head!.split('\x1f') as [string, string];
      return { sha, subject, ...parseCommitSubject(subject), files: files.filter(Boolean) };
    });
}

/** The commits that changed `path`, newest first. */
export function commitsTouching(path: string): string[] {
  return git(['log', '--format=%H', '--end-of-options', 'HEAD', '--', path]).split('\n').filter(Boolean);
}

export function commit(files: readonly string[], message: string): void {
  git(['add', '--', ...files]);
  // Only the release files: anything else already staged stays staged, out of the release commit.
  git(['commit', '-m', message, '--', ...files]);
}

/**
 * Writes the sources of `ref` (src and the lockfile, which is all codeInputs reads) into `dir`. False when none of the
 * entries exists at that commit (a scratch repository, or an entry added later), which is an empty graph, not an error.
 */
function extractSources(ref: string, dir: string, cwd: string, entries: readonly string[]): boolean {
  const run = (cmd: string, args: readonly string[], input?: Buffer) => spawnSync(cmd, [...args], { cwd, input, maxBuffer: 1024 * 1024 * 1024 });
  const listed = run('git', ['ls-tree', '--name-only', '--end-of-options', safeRef(ref), '--', ...entries]);
  if (listed.error !== undefined || listed.status !== 0) throw new DataError(`${ref} is not a commit in this repository`);
  if (listed.stdout.toString().trim() === '') return false;
  const tar = run('git', ['archive', '--format=tar', '--end-of-options', safeRef(ref), 'src', 'package-lock.json']);
  if (tar.error !== undefined || tar.status !== 0) throw new DataError(`git archive ${ref} failed`);
  const out = spawnSync('tar', ['-x', '-f', '-', '-C', dir], { input: tar.stdout });
  if (out.error !== undefined || out.status !== 0) throw new DataError(`could not unpack ${ref}`);
  return true;
}

/** One place to read an engine graph from. */
export interface EngineRef {
  /** A commit-ish, or null for the working tree. */
  ref: string | null;
  required: boolean;
}

/**
 * The repo-relative files the engine entries import: at each of `refs` (unpacked to a temporary folder, so the graph is
 * the commit's own, never the working tree) or, for ref null, in the working tree. A file in the graph at any of them
 * counts, so deleting or un-importing one is still an engine change. The graph is codeInputs' own, the one the code
 * fingerprint uses. Undefined when the config names no `engineEntries`, which keeps the glob rule. An entry missing at
 * a past ref contributes nothing there, but a `required` ref (the caller's current tree) must have a graph: an entry that
 * names no file would otherwise switch the engine off without a sound.
 */
export function engineFilesAt(cfg: ClassifyRules, refs: readonly EngineRef[], cwd = process.cwd()): ReadonlySet<string> | undefined {
  const entries = cfg.engineEntries;
  if (entries === undefined) return undefined;
  const out = new Set<string>();
  for (const { ref, required } of refs) {
    const dir = ref === null ? resolve(cwd) : mkdtempSync(join(tmpdir(), 'engine-graph-'));
    const found = new Set<string>();
    try {
      if (ref === null || extractSources(ref, dir, cwd, entries)) {
        for (const entry of entries.map((e) => resolve(dir, e)).filter((e) => existsSync(e))) {
          for (const f of codeInputs([entry], dir).files) found.add(relative(dir, f).split(sep).join('/'));
        }
      }
    } finally {
      if (ref !== null) rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    }
    if (found.size === 0 && required) throw new DataError(`engineEntries (${entries.join(', ')}) name no file at ${ref ?? 'the working tree'}`);
    for (const f of found) out.add(f);
  }
  return out;
}
