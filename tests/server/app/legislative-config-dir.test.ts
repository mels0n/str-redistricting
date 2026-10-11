import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readLegislativePins } from '../../../src/server/app/legislative.js';
import { countChamber } from '../../../src/server/entities/legislative-boundary/index.js';
import { STATES } from '../../../src/server/shared/apportionment/index.js';
import { DataError, DownloadError } from '../../../src/server/shared/errors/index.js';

const CO = STATES.find((s) => s.abbr === 'CO')!;
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('legislative commands honour --config-dir', () => {
  it('reads the vintage and the pins from the given directory, not the checked-in config', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'legislative-config-'));
    dirs.push(dir);
    const pin = 'ab'.repeat(32);
    writeFileSync(join(dir, 'enacted.json'), JSON.stringify({ congress: 119, file: 'cb_2025_us_cd119_500k', candidates: ['cb_2025_us_cd119_500k'], legislative: { vintage: 2031 } }));
    writeFileSync(join(dir, 'census-sha256.json'), JSON.stringify({ 'cb_2031_08_sldl_500k.zip': pin }));
    expect(await readLegislativePins(dir)).toEqual({ vintage: 2031, manifest: { 'cb_2031_08_sldl_500k.zip': pin } });
    // The checked-in vintage is a different one, so this would fail if the process-wide config were read.
    expect(JSON.parse(readFileSync('config/enacted.json', 'utf8')).legislative.vintage).not.toBe(2031);
  });

  it('counts against the given pins: a file the checked-in manifest pins but the given one does not is not trusted', async () => {
    const cache = mkdtempSync(join(tmpdir(), 'legislative-cache-'));
    dirs.push(cache);
    mkdirSync(cache, { recursive: true });
    const served = (): Promise<unknown> => Promise.resolve({});
    const absent = (): Promise<unknown> => Promise.reject(new DownloadError('gone', 404));
    // 2025 Colorado House is pinned in config/census-sha256.json; an empty manifest means "not pinned".
    await expect(countChamber(CO, 'state-house', 2025, cache, served, {})).rejects.toBeInstanceOf(DataError);
    expect(await countChamber(CO, 'state-house', 2025, cache, absent, {})).toBe(0);
  });
});
