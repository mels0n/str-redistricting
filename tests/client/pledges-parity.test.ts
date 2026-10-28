import { describe, expect, it } from 'vitest';
import { PledgesFileSchema as serverSchema } from '../../src/server/features/pledges';
import { PledgesFileSchema as clientSchema } from '../../src/client/entities/pledges';

const ok = {
  id: 'jane-doe-co-03', name: 'Jane Doe', role: 'incumbent', personId: 'D000001', office: 'us-house', state: 'CO', districtCode: '03',
  statementUrl: 'https://example.org/statement', campaignUrl: null, pledgedOn: '2026-10-01', cycle: null,
};

describe('pledges schema parity', () => {
  it('accepts and rejects the same shapes on both sides (duplicate ids are checked by the build only)', () => {
    const cases = [
      { pledges: [ok] },
      { pledges: [{ ...ok, party: 'X' }] },
      { pledges: [{ ...ok, statementUrl: 'http://x.org/' }] },
      { pledges: [{ ...ok, campaignUrl: 'http://x.org/' }] },
      { pledges: [], extra: 1 },
    ];
    for (const c of cases) expect(clientSchema.safeParse(c).success, JSON.stringify(c)).toBe(serverSchema.safeParse(c).success);
  });
});
