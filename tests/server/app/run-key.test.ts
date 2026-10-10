import { describe, expect, it } from 'vitest';
import { exploreCodeSha256, runKeyFor } from '../../../src/server/app/run-key.js';
import { stateByAbbr } from '../../../src/server/shared/apportionment/index.js';

describe('run key', () => {
  it('is the same for explore and publish-data given the same state and code', () => {
    const state = stateByAbbr('RI')!;
    const code = exploreCodeSha256();
    expect(runKeyFor(state, code)).toEqual(runKeyFor(stateByAbbr('RI')!, exploreCodeSha256()));
    expect(runKeyFor(state, code)).toMatchObject({ seats: state.seats, codeSha256: code });
  });
});
