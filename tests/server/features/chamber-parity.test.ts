import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeSharePages, sharePageHtml } from '../../../build/share-pages.js';
import { CHAMBERS as CLIENT_CHAMBERS, chamberDataPath, chamberLabel as clientLabel, sharePath } from '../../../src/client/shared/lib/chamber.js';
import { CHAMBERS, chamberLabel, planDir } from '../../../src/server/shared/chamber/index.js';

// The generator, the viewer and the share-page build each spell out where a chamber lives and what it is called.
// They cannot import one another, so this test is what keeps the three in step.

describe('chamber naming agrees across the generator, the viewer and the share pages', () => {
  it('lists the same chambers', () => {
    expect(CLIENT_CHAMBERS.map((c) => c.key)).toEqual([...CHAMBERS]);
  });

  it('puts a chamber\'s files in the same folder (server planDir, viewer chamberDataPath)', () => {
    for (const chamber of CHAMBERS) for (const abbr of ['CO', 'VT', 'NE']) expect(chamberDataPath(abbr, chamber), `${abbr} ${chamber}`).toBe(planDir(abbr, chamber));
  });

  it('names a state chamber the same way in the viewer and on the share page', () => {
    for (const chamber of CHAMBERS) {
      if (chamber === 'federal-house') continue;
      expect(clientLabel(chamber)).toBe(chamberLabel(chamber));
      const html = sharePageHtml({ abbr: 'CO', name: 'Colorado', seats: 10, chamber }, 'https://example.test');
      expect(html).toContain(`Colorado ${clientLabel(chamber)}`);
    }
  });

  describe('share page paths', () => {
    let root: string;
    beforeEach(() => {
      root = mkdtempSync(join(tmpdir(), 'chamber-parity-'));
    });
    afterEach(() => rmSync(root, { recursive: true, force: true }));

    it('writes each chamber\'s page at the path the viewer links to', () => {
      const pub = join(root, 'public');
      const dist = join(root, 'dist');
      mkdirSync(join(pub, 'data'), { recursive: true });
      writeFileSync(join(pub, 'data', 'index.json'), JSON.stringify({ states: [
        { abbr: 'CO', name: 'Colorado', seats: 8, hasData: true, chambers: { 'state-house': { seats: 65, hasData: true }, 'state-senate': { seats: 35, hasData: true } } },
      ] }));
      const written = writeSharePages(pub, dist).map((p) => `/${p}/`).sort();
      const linked = CHAMBERS.map((c) => sharePath('CO', c)).sort();
      expect(written).toEqual(linked);
    });
  });
});
