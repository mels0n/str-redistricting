import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanForBadge } from '../../src/server/features/badge/index.js';
import { BADGE_SIZES, stateBadgeSvg } from '../../src/server/features/publish/index.js';
import { BADGE_SNIPPET, badgeAssets, badgeSnippet, type BadgeChoice } from '../../src/client/features/badge-snippet';

const SITE = 'fairmaps.melson.us';
const choices: BadgeChoice[] = (['light', 'dark'] as const).flatMap((theme) => [
  { id: 'crest', theme },
  { id: 'seal', theme },
  { id: 'pledge', theme },
  { id: 'button', theme },
  { id: 'state', theme, abbr: 'CO', stateName: 'Colorado', seats: 8, chamber: 'federal-house' },
  { id: 'state', theme, abbr: 'CO', stateName: 'Colorado', seats: 35, chamber: 'state-senate' },
  { id: 'state', theme, abbr: 'CO', stateName: 'Colorado', seats: 65, chamber: 'state-house' },
] as BadgeChoice[]);

describe('badgeSnippet', () => {
  it('crest snippet', () => {
    expect(badgeSnippet({ id: 'crest', theme: 'light' }, SITE)).toBe(
      '<a href="https://fairmaps.melson.us/"><img src="https://fairmaps.melson.us/api/badge?badge=crest" srcset="https://fairmaps.melson.us/api/badge?badge=crest&amp;scale=2 2x" width="160" height="190" alt="Fair Maps: districts drawn by a rule"></a>',
    );
  });
  it('light button is the live snippet', () => {
    expect(badgeSnippet({ id: 'button', theme: 'light' }, SITE)).toBe(BADGE_SNIPPET);
    expect(BADGE_SNIPPET).toBe('<a href="https://fairmaps.melson.us/pledges"><img src="https://fairmaps.melson.us/api/badge" alt="I back Fair Maps" width="200" height="40"></a>');
  });
  it('dark button', () => {
    const s = badgeSnippet({ id: 'button', theme: 'dark' }, SITE);
    expect(s).toBe('<a href="https://fairmaps.melson.us/pledges"><img src="https://fairmaps.melson.us/api/badge?theme=dark" alt="I back Fair Maps" width="200" height="40"></a>');
    expect(s).not.toContain('srcset');
  });
  it('seal links to the gerrymandering answer', () => {
    expect(badgeSnippet({ id: 'seal', theme: 'light' }, SITE)).toContain('<a href="https://fairmaps.melson.us/faq/gerrymandering">');
  });
  it('dark theme adds theme=dark before scale', () => {
    const s = badgeSnippet({ id: 'pledge', theme: 'dark' }, SITE);
    expect(s).toContain('src="https://fairmaps.melson.us/api/badge?badge=pledge&amp;theme=dark"');
    expect(s).toContain('srcset="https://fairmaps.melson.us/api/badge?badge=pledge&amp;theme=dark&amp;scale=2 2x"');
  });
  it('state senate', () => {
    const a = badgeAssets({ id: 'state', theme: 'light', abbr: 'CO', stateName: 'Colorado', seats: 35, chamber: 'state-senate' }, SITE);
    expect(a.href).toBe('https://fairmaps.melson.us/CO/senate');
    expect(a.image).toBe('https://fairmaps.melson.us/api/badge?badge=state&state=CO&chamber=senate');
    expect(a.previewImage).toBe('/api/badge?badge=state&state=CO&chamber=senate');
    expect(a.previewImage2x).toBe('/api/badge?badge=state&state=CO&chamber=senate&scale=2');
    expect(a.downloads.map((d) => d.href)).toEqual(['https://fairmaps.melson.us/data/CO/state-senate/badge@2x.png']);
    expect(a.alt).toBe('Fair maps for the Colorado Senate: 35 districts drawn by a rule. Fair Maps');
    expect([a.width, a.height]).toEqual([300, 240]);
  });
  it('state US House and one-seat wording', () => {
    const a = badgeAssets({ id: 'state', theme: 'dark', abbr: 'WY', stateName: 'Wyoming', seats: 1 }, SITE);
    expect(a.href).toBe('https://fairmaps.melson.us/WY');
    expect(a.image).toBe('https://fairmaps.melson.us/api/badge?badge=state&state=WY&theme=dark');
    expect(a.downloads[0]?.href).toBe('https://fairmaps.melson.us/data/WY/badge-dark@2x.png');
    expect(a.alt).toBe('I support fair maps for Wyoming: 1 district drawn by a rule. Fair Maps');
  });
  it('previews come from the page origin, with a plain &', () => {
    for (const c of choices) {
      const a = badgeAssets(c, SITE);
      for (const url of [a.previewImage, a.previewImage2x]) {
        if (url === undefined) continue;
        expect(url.startsWith('/api/badge')).toBe(true);
        expect(url).not.toContain('&amp;');
      }
      expect(a.image.endsWith(a.previewImage)).toBe(true);
    }
    expect(badgeAssets({ id: 'crest', theme: 'light' }, SITE).previewImage).toBe('/api/badge?badge=crest');
  });
  it('downloads for the fixed badges and the button', () => {
    expect(badgeAssets({ id: 'seal', theme: 'dark' }, SITE).downloads.map((d) => d.href)).toEqual(['https://fairmaps.melson.us/badges/seal-dark@2x.png', 'https://fairmaps.melson.us/badges/seal-dark-print.png']);
    expect(badgeAssets({ id: 'button', theme: 'light' }, SITE).downloads.map((d) => d.href)).toEqual(['https://fairmaps.melson.us/badge.svg']);
    expect(badgeAssets({ id: 'button', theme: 'dark' }, SITE).downloads.map((d) => d.href)).toEqual(['https://fairmaps.melson.us/badge-dark.svg']);
  });
  it('hands back plain addresses, not escaped ones', () => {
    for (const c of choices) {
      const a = badgeAssets(c, SITE);
      for (const url of [a.image, a.image2x, a.href, ...a.downloads.map((d) => d.href)]) {
        if (url === undefined) continue;
        expect(url.startsWith('https://fairmaps.melson.us/')).toBe(true);
        expect(url).not.toContain('&amp;');
      }
      expect(a.alt).not.toContain('&amp;');
    }
  });
  it('refuses a state badge with no state', () => {
    expect(() => badgeAssets({ id: 'state', theme: 'light' }, SITE)).toThrow();
  });
  it('no scripts', () => {
    for (const c of choices) expect(badgeSnippet(c, SITE).toLowerCase()).not.toContain('<script');
  });
  it('alt text is escaped', () => {
    const s = badgeSnippet({ id: 'state', theme: 'light', abbr: 'CO', stateName: 'A & "B"', seats: 2 }, SITE);
    expect(s).toContain('alt="I support fair maps for A &amp; &quot;B&quot;: 2 districts');
  });
  it('no em dash', () => {
    for (const c of choices) expect(badgeSnippet(c, SITE)).not.toContain('—');
  });
});

describe('the scanner', () => {
  it.each(choices.map((c) => [`${c.id} ${c.theme} ${c.chamber ?? ''}`.trim(), c] as const))('counts the %s snippet', (_name, choice) => {
    expect(scanForBadge(badgeSnippet(choice, SITE), 'https://example.org/', SITE)).toMatchObject({ badge: true, link: true });
  });
});

describe('client and generator agree', () => {
  const PUBLIC = join(process.cwd(), 'public');
  const allChoices: BadgeChoice[] = [
    ...choices,
    ...(['light', 'dark'] as const).flatMap((theme) => (['federal-house', 'state-senate', 'state-house'] as const).map((chamber) => ({ id: 'state', theme, abbr: 'CO', stateName: 'Colorado', seats: 8, chamber }) as BadgeChoice)),
  ];

  it('every download exists on disk', () => {
    for (const c of allChoices) {
      for (const d of badgeAssets(c, SITE).downloads) {
        const path = join(PUBLIC, new URL(d.href).pathname);
        expect(existsSync(path), `${c.id} ${c.theme} ${c.chamber ?? ''}: ${d.href}`).toBe(true);
      }
    }
  });

  it('the ring files named by the page exist', () => {
    const ui = readFileSync(join(process.cwd(), 'src', 'client', 'pages', 'badges', 'ui.ts'), 'utf8');
    for (const name of ['FRAME_RING', 'FRAME_PRINT']) {
      const m = new RegExp(`const ${name} = '([^']+)'`).exec(ui);
      expect(m, name).not.toBeNull();
      expect(existsSync(join(PUBLIC, m![1]!)), m![1]).toBe(true);
    }
    expect(existsSync(join(PUBLIC, 'badges', 'frame.png'))).toBe(true);
    expect(existsSync(join(PUBLIC, 'badges', 'frame-print.png'))).toBe(true);
  });

  it('sizes equal the generator sizes', () => {
    for (const id of ['crest', 'seal', 'pledge', 'state'] as const) {
      const a = badgeAssets({ id, theme: 'light', abbr: 'CO', stateName: 'Colorado', seats: 8 }, SITE);
      expect({ width: a.width, height: a.height }, id).toEqual(BADGE_SIZES[id]);
    }
  });

  it('alt text starts with the headline and count the badge draws', () => {
    const topo = readFileSync(join(PUBLIC, 'data', 'CO', 'districts.topo.json'), 'utf8');
    const cases = [
      { seats: 1, chamber: 'federal-house' },
      { seats: 8, chamber: 'federal-house' },
      { seats: 35, chamber: 'state-senate' },
    ] as const;
    for (const { seats, chamber } of cases) {
      const svg = stateBadgeSvg({ name: 'Colorado', abbr: 'CO', seats, chamber, topo, theme: 'light' });
      const [headline, count] = [...svg.matchAll(/<text [^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
      const alt = badgeAssets({ id: 'state', theme: 'light', abbr: 'CO', stateName: 'Colorado', seats, chamber }, SITE).alt;
      expect(alt.startsWith(`${headline}: ${count}`), `${chamber} ${seats}`).toBe(true);
    }
  });
});
