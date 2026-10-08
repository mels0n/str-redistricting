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
