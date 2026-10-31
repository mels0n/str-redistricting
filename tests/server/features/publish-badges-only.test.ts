import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadOgFonts, publishBadgesOnly, stateBadgeFiles } from '../../../src/server/features/publish/index.js';
import { parsePublishRunConfig } from '../../../src/server/shared/config/publish-mode.js';

const BADGES = ['badge.png', 'badge@2x.png', 'badge-dark.png', 'badge-dark@2x.png'];
const SOURCE = join(process.cwd(), 'public', 'data');

let dir: string;
const snapshot = (folder: string): Record<string, string> =>
  Object.fromEntries(readdirSync(join(dir, folder)).sort().map((f) => [f, readFileSync(join(dir, folder, f)).toString('base64')]));

/** A published folder: the real districts file, a stats.json with the given seat count and a few files the run must not touch. */
function put(folder: string, seats: number): void {
  mkdirSync(join(dir, folder), { recursive: true });
  copyFileSync(join(SOURCE, folder, 'districts.topo.json'), join(dir, folder, 'districts.topo.json'));
  writeFileSync(join(dir, folder, 'stats.json'), JSON.stringify({ finished: { metrics: { seats } }, other: 1 }));
  writeFileSync(join(dir, folder, 'og.png'), 'og bytes');
  writeFileSync(join(dir, folder, 'badge.png'), 'stale badge');
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'badges-only-'));
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

describe('publish-data --badges-only', () => {
  it.each([
    ['federal-house', 'CO'],
    ['state-senate', 'CO/state-senate'],
  ] as const)('rewrites only the four badge files for %s, with the seat count from stats.json', async (chamber, folder) => {
    const seats = 5;
    put(folder, seats);
    const before = snapshot(folder);
    await publishBadgesOnly(parsePublishRunConfig(['--badges-only', '--public-dir', dir, '--states', 'CO', '--chamber', chamber]));
    const after = snapshot(folder);
    const changed = Object.keys(after).filter((f) => after[f] !== before[f]);
    expect(changed.sort()).toEqual([...BADGES].sort());
    expect(Object.keys(after).sort()).toEqual(Object.keys(before).concat(BADGES.filter((b) => !(b in before))).sort());
    const expected = stateBadgeFiles({ name: 'Colorado', abbr: 'CO', seats, chamber, topo: readFileSync(join(dir, folder, 'districts.topo.json'), 'utf8') }, await loadOgFonts());
    for (const [name, bytes] of expected) expect(readFileSync(join(dir, folder, name)).equals(Buffer.from(bytes))).toBe(true);
  });
});
