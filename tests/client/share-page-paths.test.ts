// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { sharePagePaths } from '../../build/share-pages';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function publicWith(index: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'share-paths-'));
  dirs.push(dir);
  mkdirSync(join(dir, 'data'));
  writeFileSync(join(dir, 'data', 'index.json'), JSON.stringify(index));
  return dir;
}

describe('sharePagePaths', () => {
  it('lists each state with data and each of its chambers with data and seats', () => {
    const dir = publicWith({
      states: [
        { abbr: 'CO', name: 'Colorado', seats: 8, hasData: true, chambers: { 'state-house': { seats: 65, hasData: true }, 'state-senate': { seats: 35, hasData: false } } },
        { abbr: 'NE', name: 'Nebraska', seats: 3, hasData: true, chambers: { 'state-house': { seats: 0, hasData: true }, 'state-senate': { seats: 49, hasData: true } } },
        { abbr: 'WY', name: 'Wyoming', seats: 1, hasData: false, chambers: { 'state-house': { seats: 62, hasData: true } } },
      ],
    });
    expect(sharePagePaths(dir)).toEqual(['CO', 'CO/house', 'NE', 'NE/senate']);
  });

  it('lists nothing when no index is published', () => {
    const dir = mkdtempSync(join(tmpdir(), 'share-paths-'));
    dirs.push(dir);
    expect(sharePagePaths(dir)).toEqual([]);
  });
});
