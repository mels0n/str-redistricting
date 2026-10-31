import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BADGE_SVG, BADGE_SVG_DARK, badgeAnswer, badgeTargets } from '../../../src/server/features/badge/index.js';
import { STATES } from '../../../src/server/shared/apportionment/index.js';

const answer = (query: string) => badgeAnswer(new URL(`https://fairmaps.melson.us/api/badge${query}`));
const light = { kind: 'svg', svg: BADGE_SVG };

describe('the dark button', () => {
  it('is the same file as public/badge-dark.svg, and has no em dash', () => {
    expect(BADGE_SVG_DARK).toBe(readFileSync('public/badge-dark.svg', 'utf8'));
    expect(BADGE_SVG_DARK).not.toContain('\u2014');
  });
});

describe('badgeAnswer', () => {
  it('gives the light button with no query, and the dark one for theme=dark', () => {
    expect(answer('')).toEqual(light);
    expect(answer('?theme=dark')).toEqual({ kind: 'svg', svg: BADGE_SVG_DARK });
    expect(answer('?theme=light')).toEqual(light);
  });
  it.each([
    ['?badge=crest', '/badges/crest.png'],
    ['?badge=seal&theme=dark', '/badges/seal-dark.png'],
    ['?badge=pledge&scale=2', '/badges/pledge@2x.png'],
    ['?badge=crest&theme=dark&scale=2', '/badges/crest-dark@2x.png'],
    ['?badge=crest&state=CO', '/badges/crest.png'],
    ['?badge=state&state=CO', '/data/CO/badge.png'],
    ['?badge=state&state=CO&theme=dark&scale=2', '/data/CO/badge-dark@2x.png'],
    ['?badge=state&state=CO&chamber=senate', '/data/CO/state-senate/badge.png'],
    ['?badge=state&state=CO&chamber=house', '/data/CO/state-house/badge.png'],
    ['?badge=state&state=NE&chamber=senate', '/data/NE/state-senate/badge.png'],
    ['?badge=state&state=CO&other=1', '/data/CO/badge.png'],
  ])('%s redirects to %s', (query, path) => {
    expect(answer(query)).toEqual({ kind: 'redirect', path });
  });
  it.each(['?badge=nope', '?badge=state', '?badge=state&state=ZZ', '?badge=state&state=co', '?badge=state&state=NE&chamber=house', '?badge=crest&scale=3', '?badge=crest&theme=blue', '?badge=state&state=CO&chamber=both'])('%s gives the light button', (query) => {
    expect(answer(query)).toEqual(light);
  });
});

describe('badgeTargets', () => {
  it('lists every path the schema can redirect to', () => {
    const targets = badgeTargets();
    const fixed = targets.filter((t) => t.startsWith('/badges/'));
    expect(fixed).toHaveLength(12);
    expect(targets).toHaveLength(12 + (STATES.length * 3 - 1) * 4);
    expect(new Set(targets).size).toBe(targets.length);
    expect(targets).toContain('/data/CO/state-house/badge-dark@2x.png');
    expect(targets).not.toContain('/data/NE/state-house/badge.png');
  });
  it('every badge address has its file', () => {
    const missing = badgeTargets().filter((t) => !existsSync(`public${t}`));
    expect(missing).toEqual([]);
  });
});
