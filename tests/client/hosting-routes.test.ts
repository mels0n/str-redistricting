// @vitest-environment node
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { PAGE_META } from '../../src/client/shared/lib/page-meta';

interface Rewrite {
  source: string;
  destination: string;
}
const config = JSON.parse(readFileSync('vercel.json', 'utf8')) as { trailingSlash?: boolean; rewrites: Rewrite[] };

/** A small stand-in for the host's path matcher: `:name(re)`, `:name+`, `:name*` and `:name`. */
function compile(source: string): { re: RegExp; names: string[] } {
  const names: string[] = [];
  const pattern = source.replace(/:(\w+)(\([^)]*\))?([+*])?/g, (_m, name: string, group?: string, mod?: string) => {
    names.push(name);
    if (group) return group;
    if (mod === '+') return '(.+)';
    if (mod === '*') return '(.*)';
    return '([^/]+)';
  });
  return { re: new RegExp(`^${pattern}$`), names };
}

function route(path: string): string | null {
  for (const rule of config.rewrites) {
    const { re, names } = compile(rule.source);
    const m = re.exec(path);
    if (!m) continue;
    return rule.destination.replace(/:(\w+)/g, (_x, name: string) => m[names.indexOf(name) + 1] ?? '');
  }
  return null;
}

describe('hosting routes for path URLs', () => {
  beforeAll(() => {
    // Another suite builds into dist/ too; building at the same time would race, so build only when it is missing.
    if (!existsSync('dist/index.html')) execSync('npm run build', { stdio: 'ignore' });
  }, 120_000);

  it('drops trailing slashes', () => {
    expect(config.trailingSlash).toBe(false);
  });

  it.each([
    ['/how/balancing', '/how/index.html'],
    ['/faq/ties', '/faq/index.html'],
    ['/house', '/index.html'],
    ['/CO/senate/d/12', '/CO/senate/index.html'],
    ['/CO/d/3', '/CO/index.html'],
    ['/co/d/3', '/index.html'],
    ['/wp-admin/x', null],
  ])('routes %s to %s', (path, expected) => {
    expect(route(path)).toBe(expected);
  });

  it('has a prerendered file for every fixed page', () => {
    for (const { path } of Object.values(PAGE_META)) {
      expect(existsSync(`dist${path === '/' ? '' : path}/index.html`)).toBe(true);
    }
  });
});
