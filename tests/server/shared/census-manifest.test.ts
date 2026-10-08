import { describe, expect, it } from 'vitest';
import { ENACTED_CANDIDATES, COUNTIES_FILE, LAND_FILE, STATES_FILE } from '../../../src/server/features/publish/boundary.js';
import { STATES } from '../../../src/server/shared/apportionment/index.js';
import { CENSUS_SHA256, pinnedSha256 } from '../../../src/server/shared/config/index.js';

describe('pinned Census manifest', () => {
  it('has a sha256 for every state block file', () => {
    expect(STATES).toHaveLength(50);
    for (const s of STATES) expect(pinnedSha256(`tl_2020_${s.fips}_tabblock20.zip`)).toMatch(/^[0-9a-f]{64}$/);
  });
  it('has a sha256 for every boundary file the publish step can request', () => {
    for (const f of [STATES_FILE, LAND_FILE, COUNTIES_FILE, ...ENACTED_CANDIDATES]) expect(pinnedSha256(`${f}.zip`)).toMatch(/^[0-9a-f]{64}$/);
  });
  it('holds only well-formed hashes', () => {
    for (const v of Object.values(CENSUS_SHA256)) expect(v).toMatch(/^[0-9a-f]{64}$/);
  });
  it('rejects a file that is not pinned', () => {
    expect(() => pinnedSha256('tl_2020_11_tabblock20.zip')).toThrow(/not in the pinned Census manifest/);
    expect(() => pinnedSha256('constructor')).toThrow(/not in the pinned Census manifest/);
  });
});
