import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stampOf, VERSIONS } from '../../../src/server/shared/config/index.js';
import { DataError } from '../../../src/server/shared/errors/index.js';

const { publishData } = await import('../../../src/server/features/publish/index.js');
const { parsePublishConfig } = await import('../../../src/server/shared/config/index.js');

const metricsOf = (abbr: string, sha: string) => {
  const published = JSON.parse(readFileSync(new URL(`../../../public/data/${abbr}/stats.json`, import.meta.url), 'utf8')) as { finished: { metrics: object } };
  return { ...published.finished.metrics, districts: [], assignmentSha256: sha };
};

let root: string;
const put = (path: string, body: unknown): void => {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(body));
};
const snapshot = (dir: string): string[] => readdirSync(dir, { recursive: true, encoding: 'utf8' }).sort();

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'gate-all-'));
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

describe('publishData gate', () => {
  it('refuses before writing anything when a later state is refused', async () => {
    const A = 'a'.repeat(64);
    const B = 'b'.repeat(64);
    const out = join(root, 'out');
    const pub = join(root, 'public');
    // CO comes first in state order and would pass (same map); RI changed under the same versions and is refused.
    for (const [abbr, published, generated] of [['CO', A, A], ['RI', A, B]] as const) {
      put(join(out, abbr, 'metrics.json'), metricsOf(abbr, generated));
      put(join(pub, abbr, 'stats.json'), { versions: stampOf(VERSIONS), finished: { metrics: metricsOf(abbr, published) } });
    }
    const before = snapshot(pub);
    await expect(publishData(parsePublishConfig(['--out-dir', out, '--public-dir', pub, '--states', 'CO,RI']))).rejects.toBeInstanceOf(DataError);
    expect(snapshot(pub)).toEqual(before);
  });
});
