// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { config, creditLine, mountCreditStrip, VERSIONS, type VersionStamp } from '../../src/client/shared';

const stamp: VersionStamp = { engine: '1.0.0', input: { vintage: 'census-2020', revision: 1, sha256: 'c'.repeat(64) }, maps: 1, schema: '1.0.0' };
const sha = 'eaffe5a8' + 'f'.repeat(56);

describe('map credit line', () => {
  it('uses the site host', () => {
    expect(config.siteHost).toBe('fairmaps.melson.us');
  });

  it('reads in full for a stamped state', () => {
    expect(creditLine({ abbr: 'CO', name: 'Colorado', versions: stamp, sha }, false)).toBe('fairmaps.melson.us/CO · Colorado · Maps release 1 · engine 1.0.0 · eaffe5a8');
  });

  it('shortens for a narrow frame', () => {
    expect(creditLine({ abbr: 'CO', name: 'Colorado', versions: stamp, sha }, true)).toBe('fairmaps.melson.us/CO · Maps 1 · eaffe5a8');
  });

  it('degrades to the address and name when the data has no stamp', () => {
    expect(creditLine({ abbr: 'CO', name: 'Colorado', sha }, false)).toBe('fairmaps.melson.us/CO · Colorado');
    expect(creditLine({ abbr: 'CO', name: 'Colorado', sha }, true)).toBe('fairmaps.melson.us/CO');
  });

  it('names the current release and engine on the national map, with no fingerprint', () => {
    expect(creditLine({}, false)).toBe(`fairmaps.melson.us · Maps release ${VERSIONS.maps} · engine ${VERSIONS.engine}`);
    expect(creditLine({}, true)).toBe(`fairmaps.melson.us · Maps ${VERSIONS.maps} · engine ${VERSIONS.engine}`);
  });

  it('has no em dash in any form', () => {
    for (const compact of [true, false]) {
      expect(creditLine({ abbr: 'CO', name: 'Colorado', versions: stamp, sha }, compact)).not.toContain('—');
      expect(creditLine({}, compact)).not.toContain('—');
    }
  });

  it('draws a decorative strip inside the frame', () => {
    const frame = document.createElement('div');
    mountCreditStrip(frame, () => ({ abbr: 'CO', name: 'Colorado', versions: stamp, sha }));
    const strip = frame.querySelector('.strv-credit');
    expect(strip?.getAttribute('aria-hidden')).toBe('true');
    expect(strip?.textContent).toContain('eaffe5a8');
  });
});
