import { describe, expect, it } from 'vitest';
import { exploreCodeSha256, runKeyFor } from '../../../src/server/app/run-key.js';
import { stateByAbbr } from '../../../src/server/shared/apportionment/index.js';

describe('run key', () => {
  it('is the same for explore and publish-data given the same state and code', () => {
    const state = stateByAbbr('RI')!;
    const code = exploreCodeSha256();
    expect(runKeyFor(state, 'federal-house', code)).toEqual(runKeyFor(stateByAbbr('RI')!, 'federal-house', exploreCodeSha256()));
    expect(runKeyFor(state, 'federal-house', code)).toMatchObject({ chamber: 'federal-house', seats: state.seats, codeSha256: code });
  });
  it('differs by chamber', () => {
    const state = stateByAbbr('RI')!;
    const code = 'c'.repeat(64);
    const chambers = ['federal-house', 'state-house', 'state-senate'] as const;
    const keys = chambers.map((c) => JSON.stringify(runKeyFor(state, c, code)));
    expect(new Set(keys).size).toBe(3);
    expect(runKeyFor(state, 'state-senate', code).chamber).toBe('state-senate');
  });
});
