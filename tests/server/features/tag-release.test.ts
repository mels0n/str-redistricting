import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { tagsFor } from '../../../src/server/features/release/index.js';
import { VERSIONS } from '../../../src/server/shared/config/index.js';

const dir = new URL('../../../.github/workflows/', import.meta.url);
const read = (name: string): string => readFileSync(new URL(name, dir), 'utf8').replace(/\r\n/g, '\n');

describe('tag-release workflow', () => {
  it('exists and runs on pushes to main', () => {
    expect(existsSync(new URL('tag-release.yml', dir))).toBe(true);
    expect(read('tag-release.yml')).toMatch(/^on:\n {2}push:\n {4}branches: \[main\]/m);
  });

  const text = read('tag-release.yml');
  const jobs = text.slice(text.indexOf('\njobs:'));
  const tagJob = jobs.slice(jobs.indexOf('\n  tag:'));
  const planJob = jobs.slice(jobs.indexOf('\n  plan:'), jobs.indexOf('\n  tag:'));

  it('plans with a read-only token and tags with a write token that runs no package runner', () => {
    expect(planJob).toMatch(/contents: read/);
    expect(planJob).toContain('npm run -s release:tags');
    expect(tagJob).toMatch(/contents: write/);
    expect(tagJob).toMatch(/needs: plan/);
    expect(tagJob).not.toMatch(/\b(npm|npx|node|tsx|yarn|pnpm)\b/);
    expect(tagJob).toMatch(/persist-credentials: false/);
    expect(tagJob).toContain('path: ${{ runner.temp }}/release-tags');
  });

  const re = ((): RegExp => {
    const m = /re='([^']+)'/.exec(text);
    expect(m, 'the tag pattern').not.toBeNull();
    return new RegExp(m![1]!);
  })();

  it('validates every tag name against the exact shapes', () => {
    for (const tag of tagsFor(null, VERSIONS)) expect(tag, tag).toMatch(re);
    for (const ok of ['maps-12', 'input-census-2030-r3', 'engine-v2.0.0', 'docs-v1.10.3']) expect(ok).toMatch(re);
    for (const bad of ['', 'maps-', 'maps-1 ', 'maps-1\nx', 'v1.0.0', 'engine-1.0.0', 'engine-v1.0', 'input-census-20-r1', 'main', '../maps-1', 'maps-1;rm', 'refs/heads/main']) {
      expect(bad, JSON.stringify(bad)).not.toMatch(re);
    }
  });

  it('skips a remote tag at the pushed commit, fails on one elsewhere, and creates lightweight tags otherwise', () => {
    expect(tagJob).toContain('ls-remote --tags origin');
    expect(tagJob).toContain('"$remote" != "$GITHUB_SHA"');
    expect(tagJob).toMatch(/::error::\$tag already exists on the remote at/);
    expect(tagJob).toContain('git tag "$tag" "$GITHUB_SHA"');
  });

  it('plans from the push event\'s before commit, falling back to the parent, then to none', () => {
    expect(planJob).toContain('EVENT_BEFORE: ${{ github.event.before }}');
    expect(planJob).toContain('git cat-file -e');
    expect(planJob).toContain('git rev-parse --verify --quiet "HEAD^" || echo none');
    expect(planJob).toMatch(/fetch-depth: 0/);
  });
});

describe('standards workflow', () => {
  const text = read('standards.yml');
  it('checks out full history and runs the version check on pull requests', () => {
    expect(text).toMatch(/fetch-depth: 0/);
    expect(text).toContain('npm run version:check -- --base "origin/$BASE_REF"');
    expect(text).toMatch(/github\.event_name == 'pull_request'/);
  });
  it('has a fixture gate that caches the Census files by manifest hash', () => {
    expect(text).toMatch(/^ {2}fixture-gate:/m);
    expect(text).toContain("key: census-${{ hashFiles('config/census-sha256.json') }}");
    expect(text).toContain('path: data/raw');
    expect(text).toContain('npm run fingerprints -- --check --base "origin/$BASE_REF"');
    expect(text).toContain('npm run fingerprints -- --check --base "HEAD^"');
    expect(text).toMatch(/timeout-minutes: 30/);
  });
});
