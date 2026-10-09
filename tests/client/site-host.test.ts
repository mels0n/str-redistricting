import { describe, expect, it } from 'vitest';
import { config, creditLine, type VersionStamp } from '../../src/client/shared';
import { SITE_HOST } from '../../src/server/features/publish/site';
import { ogCredit } from '../../src/server/features/publish/og-credit';

// The client config repeats the server's site host, and the map credit strip repeats the link preview's
// credit line; these keep the copies equal.
describe('site host and credit line', () => {
  it('the client and server name the same host', () => {
    expect(config.siteHost).toBe(SITE_HOST);
  });

  it('the full map credit equals the link preview credit', () => {
    const versions: VersionStamp = { engine: '1.2.3', input: { vintage: 'census-2020', revision: 2, sha256: 'c'.repeat(64) }, maps: 4, schema: '1.0.0' };
    const sha = '0123abcd' + 'e'.repeat(56);
    expect(creditLine({ abbr: 'CO', name: 'Colorado', versions, sha }, false)).toBe(ogCredit({ abbr: 'CO', name: 'Colorado', versions, assignmentSha256: sha }));
  });
});
