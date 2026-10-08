import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const dir = new URL('../../../.github/workflows/', import.meta.url);
const workflows = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f));

// The repository lets GitHub Actions open pull requests (the enacted districts update needs it), and that same
// setting would also let a workflow approve or merge one. No workflow may ever do either: a person always reviews
// and merges.
const FORBIDDEN = [
  /gh\s+pr\s+review/i,
  /gh\s+pr\s+merge/i,
  /--approve\b/i,
  /\bAPPROVE\b/,
  /createReview|pulls\/\S*\/reviews|pulls\/\S*\/merge/i,
  /enablePullRequestAutoMerge|--auto\b/i,
  /mergePullRequest|addPullRequestReview|submitPullRequestReview/i,
  /pulls\.merge|pulls\.createReview/i,
  /auto-?approve|automerge|auto-merge/i,
];

describe('workflows never approve or merge a pull request', () => {
  it('finds the workflows', () => {
    expect(workflows).toContain('enacted-update.yml');
  });
  for (const file of workflows) {
    it(file, () => {
      const text = readFileSync(new URL(file, dir), 'utf8');
      for (const pattern of FORBIDDEN) expect(text, `${file} matches ${pattern}`).not.toMatch(pattern);
    });
  }
});

// The workflow files are simple and the repository has no YAML dependency, so this reads them line by line: keys at
// fixed indentation, `permissions:` as an inline value or an indented block, steps as `- ` items, `run:` as a block.

const WRITES = /\b(contents|pull-requests)\s*:\s*write\b|\bwrite-all\b/;
const PACKAGE_RUNNERS = /\b(npm|npx|node|tsx|yarn|pnpm)\b/;
const WRITE_JOB_ACTIONS = new Set(['actions/checkout', 'actions/download-artifact', 'actions/upload-artifact']);

// In a job that holds a write permission a `run:` block may use only these commands (plus shell keywords and variable
// assignments). Nothing that executes repository code: no ./script, bash, sh, python, make, node, npm, npx or tsx.
const RUN_ALLOWLIST = new Set([
  'git', 'gh', 'jq', 'test', '[', '[[', 'echo', 'printf', 'cat', 'find', 'cp', 'mkdir', 'set', 'if', 'for', 'while', 'case',
  'exit', 'true', 'base64', 'cut', 'grep', 'rm', 'local', 'read', 'shift', '{', '}',
]);
const SHELL_WORDS = new Set(['fi', 'then', 'else', 'elif', 'done', 'do', 'esac', 'continue', 'break', 'return', ';;', '(', ')']);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*(\[[^\]]*\])?\+?=/;

const indentOf = (line: string): number => line.length - line.trimStart().length;

/** The text of a `permissions:` key found at `indent`, whether written inline or as an indented block. */
function permissionsAt(lines: readonly string[], indent: number): string {
  return permissionsIn(lines, indent) ?? '';
}

function permissionsIn(lines: readonly string[], indent: number): string | null {
  const at = lines.findIndex((l) => indentOf(l) === indent && /^permissions:/.test(l.trim()));
  if (at === -1) return null;
  const out = [lines[at]!.trim().slice('permissions:'.length)];
  for (let i = at + 1; i < lines.length && (lines[i]!.trim() === '' || indentOf(lines[i]!) > indent); i++) out.push(lines[i]!);
  return out.join('\n');
}

interface Step {
  readonly uses: string | null;
  readonly run: string;
  /** The `path:` and `persist-credentials:` inputs, when the step sets them (quotes stripped). */
  readonly path: string | null;
  readonly persistCredentials: string | null;
}
interface Job {
  readonly name: string;
  /** null when the job declares none. */
  readonly permissions: string | null;
  readonly steps: readonly Step[];
}

function parseJobs(lines: readonly string[]): Job[] {
  const start = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  if (start === -1) return [];
  const body = lines.slice(start + 1);
  const heads = body.flatMap((l, i) => (indentOf(l) === 2 && /^\s{2}[\w-]+:\s*$/.test(l) ? [i] : []));
  return heads.map((from, n) => {
    const jobLines = body.slice(from + 1, heads[n + 1] ?? body.length);
    const stepsAt = jobLines.findIndex((l) => indentOf(l) === 4 && /^steps:\s*$/.test(l.trim()));
    const stepLines = stepsAt === -1 ? [] : jobLines.slice(stepsAt + 1);
    const items: string[][] = [];
    for (const l of stepLines) {
      if (/^\s{6}- /.test(l)) items.push([l]);
      else items.at(-1)?.push(l);
    }
    const steps = items.map((item): Step => {
      const uses = item.map((l) => /^\s*(?:- )?uses:\s*(\S+)/.exec(l)?.[1]).find((u) => u !== undefined) ?? null;
      const runAt = item.findIndex((l) => /^\s*(?:- )?run:/.test(l));
      let run = '';
      if (runAt !== -1) {
        const first = item[runAt]!.replace(/^\s*(?:- )?run:/, '');
        const runIndent = indentOf(item[runAt]!.replace('- ', '  '));
        const block = [first];
        for (let i = runAt + 1; i < item.length && (item[i]!.trim() === '' || indentOf(item[i]!) > runIndent); i++) block.push(item[i]!);
        run = block.join('\n');
      }
      const input = (key: string): string | null => {
        const m = item.map((l) => new RegExp(`^\\s+${key}:\\s*(.*?)\\s*$`).exec(l)?.[1]).find((v) => v !== undefined);
        return m === undefined ? null : m.replace(/^(['"])(.*)\1$/, '$2');
      };
      return { uses, run, path: input('path'), persistCredentials: input('persist-credentials') };
    });
    return { name: body[from]!.trim().replace(/:$/, ''), permissions: permissionsIn(jobLines, 4), steps };
  });
}

/**
 * The commands a run block invokes, one per line: the first token after trimming. A line-based heuristic, not a shell
 * parser. It skips blank lines, comments, heredoc bodies, lines continued from a trailing backslash, lines that begin
 * with a pipe or a closing parenthesis, and bare shell keywords. Its limits: a command hidden inside `$(...)` or
 * after `&&`, `||` or `;` on the same line is not seen (the npm/node/tsx word check on the whole block still is),
 * and an assignment is accepted whatever its right-hand side. It is a tripwire for the common ways of running
 * repository code, not a sandbox.
 */
export function runCommands(run: string): string[] {
  const out: string[] = [];
  let heredoc: string | null = null;
  let continued = false;
  for (const raw of run.split('\n')) {
    const line = raw.trim();
    if (heredoc !== null) {
      if (line === heredoc) heredoc = null;
      continue;
    }
    const wasContinued = continued;
    continued = line.endsWith('\\');
    const start = /<<-?\s*(['"]?)(\w+)\1/.exec(line);
    if (start !== null) heredoc = start[2]!;
    if (wasContinued || line === '' || line.startsWith('#') || line.startsWith('|') || line.startsWith(')')) continue;
    const token = line.split(/\s+/)[0]!;
    if (SHELL_WORDS.has(token) || ASSIGNMENT.test(token)) continue;
    out.push(token);
  }
  return out;
}

/** What is wrong with a workflow's permissions, as readable lines; empty when it is fine. */
export function permissionProblems(text: string): string[] {
  const lines = text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((l) => !l.trim().startsWith('#'));
  const problems: string[] = [];
  const top = permissionsAt(lines, 0);
  if (permissionsIn(lines, 0) === null) problems.push('has no top-level permissions key');
  if (WRITES.test(top)) problems.push('grants a write permission at workflow level');
  for (const job of parseJobs(lines)) {
    // A job that declares no permissions of its own inherits the workflow's.
    if (!WRITES.test(job.permissions ?? top)) continue;
    job.steps.forEach((step, i) => {
      if (PACKAGE_RUNNERS.test(step.run)) problems.push(`job ${job.name} holds a write permission and step ${i + 1} runs npm, node or similar`);
      if (step.uses !== null && !WRITE_JOB_ACTIONS.has(step.uses.split('@')[0]!)) {
        problems.push(`job ${job.name} holds a write permission and step ${i + 1} uses ${step.uses}`);
      }
      const action = step.uses?.split('@')[0];
      if (action === 'actions/download-artifact' && !(step.path ?? '').startsWith('${{ runner.temp }}')) {
        problems.push(`job ${job.name} holds a write permission and step ${i + 1} downloads an artifact into ${step.path ?? 'the workspace'}, not under runner.temp`);
      }
      if (action === 'actions/checkout' && step.persistCredentials !== 'false') {
        problems.push(`job ${job.name} holds a write permission and step ${i + 1} checks out without persist-credentials: false`);
      }
      for (const cmd of runCommands(step.run)) {
        if (!RUN_ALLOWLIST.has(cmd)) problems.push(`job ${job.name} holds a write permission and step ${i + 1} runs ${cmd}, which is not on the allowlist`);
      }
    });
  }
  return problems;
}

describe('workflow write tokens never reach dependency code', () => {
  for (const file of workflows) {
    it(file, () => {
      expect(permissionProblems(readFileSync(new URL(file, dir), 'utf8'))).toEqual([]);
    });
  }

  it('sees the write job of the enacted districts update (so the check above is not vacuous)', () => {
    const text = readFileSync(new URL('enacted-update.yml', dir), 'utf8');
    const lines = text.replace(/\r\n/g, '\n').split('\n');
    const writers = parseJobs(lines).filter((j) => WRITES.test(j.permissions ?? ''));
    expect(writers.map((j) => j.name)).toEqual(['open-pr']);
    expect(writers[0]!.steps.length).toBeGreaterThan(2);
  });

  const OLD_SHAPE = [
    'permissions:',
    '  contents: write',
    '  pull-requests: write',
    'jobs:',
    '  update:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - uses: actions/checkout@v4',
    '      - name: Install',
    '        run: npm ci',
    '',
  ].join('\n');

  it('flags the old shape: write at workflow level and npm in the job', () => {
    expect(permissionProblems(OLD_SHAPE)).toEqual([
      'grants a write permission at workflow level',
      'job update holds a write permission and step 1 checks out without persist-credentials: false',
      'job update holds a write permission and step 2 runs npm, node or similar',
      'job update holds a write permission and step 2 runs npm, which is not on the allowlist',
    ]);
  });
  it('flags npm and a third-party action in a job that holds a write permission', () => {
    const job = [
      'permissions: {}',
      'jobs:',
      '  open-pr:',
      '    permissions:',
      '      contents: write',
      '    steps:',
      '      - uses: actions/checkout@v4',
      '      - uses: actions/setup-node@v4',
      '      - name: Build',
      '        run: |',
      '          npm ci',
      '',
    ].join('\n');
    expect(permissionProblems(job)).toEqual([
      'job open-pr holds a write permission and step 1 checks out without persist-credentials: false',
      'job open-pr holds a write permission and step 2 uses actions/setup-node@v4',
      'job open-pr holds a write permission and step 3 runs npm, node or similar',
      'job open-pr holds a write permission and step 3 runs npm, which is not on the allowlist',
    ]);
  });

  it('flags a workflow with no top-level permissions key', () => {
    expect(permissionProblems('jobs:\n  a:\n    permissions:\n      contents: read\n    steps:\n      - run: echo hi\n')).toEqual([
      'has no top-level permissions key',
    ]);
  });

  const writeJob = (steps: string[]): string =>
    ['permissions: {}', 'jobs:', '  open-pr:', '    permissions:', '      contents: write', '    steps:', ...steps, ''].join('\n');

  it('flags a download into the workspace', () => {
    const text = writeJob(['      - uses: actions/download-artifact@v4', '        with:', '          name: x', '          path: .']);
    expect(permissionProblems(text)).toEqual(['job open-pr holds a write permission and step 1 downloads an artifact into ., not under runner.temp']);
    const ok = writeJob(['      - uses: actions/download-artifact@v4', '        with:', '          name: x', '          path: ${{ runner.temp }}/a']);
    expect(permissionProblems(ok)).toEqual([]);
  });
  it('flags a checkout that keeps credentials', () => {
    expect(permissionProblems(writeJob(['      - uses: actions/checkout@v4']))).toEqual([
      'job open-pr holds a write permission and step 1 checks out without persist-credentials: false',
    ]);
    expect(permissionProblems(writeJob(['      - uses: actions/checkout@v4', '        with:', '          persist-credentials: true']))).toHaveLength(1);
    expect(permissionProblems(writeJob(['      - uses: actions/checkout@v4', '        with:', '          persist-credentials: false']))).toEqual([]);
  });
  it('flags commands outside the run allowlist in a write job, and only there', () => {
    for (const cmd of ['./scripts/x.sh', 'bash x.sh', 'sh x.sh', 'python x.py', 'make build', 'node x.js', 'npm test', 'npx tsx x.ts', 'tsx x.ts']) {
      const problems = permissionProblems(writeJob(['      - run: |', `          ${cmd}`]));
      expect(problems.length, cmd).toBeGreaterThan(0);
    }
    const readOnly = ['permissions: {}', 'jobs:', '  a:', '    permissions:', '      contents: read', '    steps:', '      - run: ./x.sh', ''].join('\n');
    expect(permissionProblems(readOnly)).toEqual([]);
  });
  it('reads allowed commands, keywords, assignments, comments, continuations and heredoc bodies as fine', () => {
    const run = [
      'set -euo pipefail',
      'FILE="$1"',
      '# a comment',
      'if ! [[ "$FILE" =~ x ]]; then',
      '  echo no',
      'fi',
      'x=$(git status --porcelain \\',
      '  | cut -c4-)',
      'cat > out <<EOF',
      'npm run something in prose',
      'EOF',
      'files+=("$FILE")',
    ];
    expect(runCommands(run.join('\n'))).toEqual(['set', 'if', 'echo', 'cat']);
  });
});
