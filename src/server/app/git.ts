import { spawnSync } from 'node:child_process';
import { parseCommitSubject, type Commit } from '../features/release/index.js';
import { DataError } from '../shared/errors/index.js';

/** Runs git in the current directory; returns stdout, or null when git exits non-zero. */
function tryGit(args: readonly string[]): string | null {
  const r = spawnSync('git', [...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.error !== undefined) throw new DataError(`could not run git: ${r.error.message}`);
  return r.status === 0 ? r.stdout : null;
}

function git(args: readonly string[]): string {
  const out = tryGit(args);
  if (out === null) throw new DataError(`git ${args.join(' ')} failed`);
  return out;
}

/** The text of `path` at `ref`, or null when it does not exist there. */
export function showFile(ref: string, path: string): string | null {
  return tryGit(['show', `${ref}:${path}`]);
}

/** Every tag in the repository. */
export function listTags(): string[] {
  return git(['tag', '--list']).split('\n').filter(Boolean);
}

/** The best common ancestor of two refs, or null when they share no history. */
export function mergeBase(a: string, b: string): string | null {
  const out = tryGit(['merge-base', a, b]);
  return out === null ? null : out.trim();
}

export function tagExists(tag: string): boolean {
  return tryGit(['rev-parse', '--verify', '--quiet', `refs/tags/${tag}`]) !== null;
}

/** Files that differ between the merge base of `base` and `head`, and `head`. */
export function changedFiles(base: string, head: string): string[] {
  return git(['diff', '--name-only', '--no-renames', `${base}...${head}`]).split('\n').filter(Boolean);
}

/** The commits reachable from HEAD and not from `ref` (all of them when `ref` is null), newest first, merges left out. */
export function commitsSince(ref: string | null): Commit[] {
  const range = ref === null ? ['HEAD'] : [`${ref}..HEAD`];
  const out = git(['log', '--no-merges', '--no-renames', '--name-only', '--format=%x1e%H%x1f%s', ...range]);
  return out
    .split('\x1e')
    .filter((chunk) => chunk.trim() !== '')
    .map((chunk) => {
      const [head, ...files] = chunk.split('\n');
      const [sha, subject] = head!.split('\x1f') as [string, string];
      return { sha, subject, ...parseCommitSubject(subject), files: files.filter(Boolean) };
    });
}

export function commit(files: readonly string[], message: string): void {
  git(['add', '--', ...files]);
  // Only the release files: anything else already staged stays staged, out of the release commit.
  git(['commit', '-m', message, '--', ...files]);
}
