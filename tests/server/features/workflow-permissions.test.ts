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

// The enacted update runs npm (dependencies, repo scripts) and also writes to the repository. Those two must never be
// the same job: a compromised dependency would otherwise hold a write token. No YAML parser is installed, so the jobs
// are split structurally (two-space job keys under "jobs:", four-space "permissions:" blocks, "- " steps).
type Job = { body: string; perms: Record<string, string>; steps: string[] };

function parsePerms(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of block.split(/\r?\n/)) {
    const m = line.match(/^\s+([\w-]+):\s*(\S+)\s*$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function parseJobs(text: string): Map<string, Job> {
  const clean = text
    .split(/\r?\n/)
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');
  const top = clean.match(/^permissions:[ \t]*\r?\n((?: {2}.*\n?)+)/m);
  const topPerms = top ? parsePerms(top[1]) : {};
  const jobsText = clean.slice(clean.search(/^jobs:[ \t]*$/m)).replace(/^jobs:[ \t]*\n/, '');
  const parts = jobsText.split(/^ {2}([\w-]+):[ \t]*$/m);
  const jobs = new Map<string, Job>();
  for (let i = 1; i < parts.length; i += 2) {
    const body = parts[i + 1];
    const m = body.match(/^ {4}permissions:[ \t]*\n((?: {6}.*\n?)+)/m);
    const perms = m ? parsePerms(m[1]) : topPerms;
    const stepsText = body.split(/^ {4}steps:[ \t]*$/m)[1] ?? '';
    jobs.set(parts[i], { body, perms, steps: stepsText.split(/^ {6}- /m).slice(1) });
  }
  return jobs;
}

const runsNpm = (body: string) => /\bnpm\b|setup-node/.test(body);

describe('enacted-update.yml keeps npm away from the write token', () => {
  const jobs = parseJobs(readFileSync(new URL('enacted-update.yml', dir), 'utf8'));

  it('has jobs', () => {
    expect(jobs.size).toBeGreaterThanOrEqual(2);
  });
  it('npm jobs hold no write permission and never touch the token', () => {
    const npmJobs = [...jobs].filter(([, j]) => runsNpm(j.body));
    expect(npmJobs.length).toBeGreaterThan(0);
    for (const [name, j] of npmJobs) {
      expect(j.perms['contents'], `${name} contents`).not.toBe('write');
      expect(j.perms['pull-requests'], `${name} pull-requests`).not.toBe('write');
      expect(j.body, `${name} references the token`).not.toMatch(/GH_TOKEN|github\.token|secrets\.GITHUB_TOKEN/);
    }
  });
  it('the job with contents: write runs no npm', () => {
    const writers = [...jobs].filter(([, j]) => j.perms['contents'] === 'write');
    expect(writers.length).toBeGreaterThan(0);
    for (const [name, j] of writers) expect(runsNpm(j.body), `${name} runs npm`).toBe(false);
  });
  it('checkouts in npm jobs do not persist credentials', () => {
    for (const [name, j] of jobs) {
      if (!runsNpm(j.body)) continue;
      const checkouts = j.steps.filter((s) => /uses:\s*actions\/checkout/.test(s));
      expect(checkouts.length, `${name} checkouts`).toBeGreaterThan(0);
      for (const s of checkouts) expect(s, `${name} checkout`).toMatch(/persist-credentials:\s*false/);
    }
  });
});
