import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { crestSvg, fixedBadgeFiles, frameSvg, loadOgFonts, pledgeSvg, sealSvg, stateBadgeFiles, stateBadgeSvg } from '../../src/server/features/publish/index.js';

const THEMES = ['light', 'dark'] as const;
const BADGES_DIR = join(process.cwd(), 'public', 'badges');

const allSvgs = (): string[] => [...THEMES.flatMap((t) => [crestSvg(t), sealSvg(t), pledgeSvg(t)]), frameSvg()];
const pngWidth = (png: Uint8Array): number => Buffer.from(png).readUInt32BE(16);
const pngHeight = (png: Uint8Array): number => Buffer.from(png).readUInt32BE(20);

describe('fixed badges', () => {
  it('each fixed badge carries its copy', () => {
    expect(crestSvg('light')).toContain('FAIR MAPS');
    expect(crestSvg('light')).toContain('Drawn by a rule');
    expect(sealSvg('light')).toContain('END GERRYMANDERING');
    expect(pledgeSvg('light')).toContain('I PLEDGE');
    expect(pledgeSvg('light')).toContain('to support fair maps');
    expect(frameSvg()).toContain('I SUPPORT FAIR MAPS');
  });

  it('no badge text has an em dash', () => {
    for (const svg of allSvgs()) expect(svg).not.toContain('—');
  });

  it('dark crest uses the ink ground', () => {
    const dark = crestSvg('dark');
    expect(dark).toContain('fill="#1A1915"');
    expect(dark).toContain('#F3EFE5');
    expect(crestSvg('light')).toContain('fill="#F3EFE5"');
  });

  it('fixedBadgeFiles names every file', async () => {
    const files = fixedBadgeFiles(await loadOgFonts());
    const expected = ['crest', 'seal', 'pledge'].flatMap((n) => ['', '-dark'].flatMap((d) => ['', '@2x', '-print'].map((s) => `${n}${d}${s}.png`)));
    expected.push('frame.png', 'frame-print.png');
    expect([...files.keys()].sort()).toEqual(expected.sort());
    expect(files.size).toBe(20);
  });

  it('2x is twice the 1x width and print is 2000 on the long side', async () => {
    const files = fixedBadgeFiles(await loadOgFonts());
    const get = (n: string): Uint8Array => files.get(n) as Uint8Array;
    expect(pngWidth(get('crest.png'))).toBe(160);
    expect(pngWidth(get('crest@2x.png'))).toBe(320);
    expect(pngWidth(get('seal.png'))).toBe(180);
    expect(pngWidth(get('pledge@2x.png'))).toBe(400);
    expect(pngWidth(get('frame.png'))).toBe(1080);
    for (const n of ['crest-print.png', 'seal-dark-print.png', 'pledge-print.png', 'frame-print.png']) {
      expect(Math.max(pngWidth(get(n)), pngHeight(get(n)))).toBe(2000);
    }
  });

  it('committed badges match a fresh render', async () => {
    const files = fixedBadgeFiles(await loadOgFonts());
    expect(readdirSync(BADGES_DIR).sort()).toEqual([...files.keys()].sort());
    for (const [name, data] of files) expect(Buffer.compare(readFileSync(join(BADGES_DIR, name)), Buffer.from(data)), name).toBe(0);
  });
});

const topoOf = (dir: string): string => readFileSync(join(process.cwd(), 'public', 'data', dir, 'districts.topo.json'), 'utf8');
const stateBadge = (abbr: string, name: string, seats: number, chamber: 'federal-house' | 'state-house' | 'state-senate', dir: string, theme: 'light' | 'dark' = 'light'): string =>
  stateBadgeSvg({ name, abbr, seats, chamber, topo: topoOf(dir), theme });

describe('state badges', () => {
  it('US House badge wording', () => {
    const svg = stateBadge('CO', 'Colorado', 8, 'federal-house', 'CO');
    expect(svg).toContain('I support fair maps for Colorado');
    expect(svg).toContain('8 districts drawn by a rule');
  });

  it('chamber wording', () => {
    expect(stateBadge('CO', 'Colorado', 35, 'state-senate', 'CO/state-senate')).toContain('Fair maps for the Colorado Senate');
    expect(stateBadge('CO', 'Colorado', 65, 'state-house', 'CO/state-house')).toContain('Fair maps for the Colorado House');
  });

  it('one seat', () => {
    expect(stateBadge('WY', 'Wyoming', 1, 'federal-house', 'WY')).toContain('1 district drawn by a rule');
  });

  it('long names fit', () => {
    for (const svg of [stateBadge('MA', 'Massachusetts', 40, 'state-senate', 'MA/state-senate'), stateBadge('NC', 'North Carolina', 14, 'federal-house', 'NC')]) {
      const m = /font-size="([\d.]+)"[^>]*>([^<]*(?:Massachusetts|North Carolina)[^<]*)</.exec(svg);
      expect(m).not.toBeNull();
      expect(Number(m![1]) * 0.55 * m![2]!.length).toBeLessThanOrEqual(280);
    }
  });

  it('Alaska stays whole', () => {
    const svg = stateBadge('AK', 'Alaska', 1, 'federal-house', 'AK');
    const xs = [...svg.matchAll(/<path d="([^"]*)"/g)].flatMap((m) => [...m[1]!.matchAll(/[ML](-?[\d.]+),/g)].map((n) => Number(n[1])));
    expect(xs.length).toBeGreaterThan(0);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(252.5);
  });

  it('dark uses the ink ground and no badge has an em dash', () => {
    const dark = stateBadge('CO', 'Colorado', 8, 'federal-house', 'CO', 'dark');
    expect(dark).toContain('fill="#1A1915"');
    expect(dark).not.toContain('—');
  });

  it('stateBadgeFiles names', async () => {
    const files = stateBadgeFiles({ name: 'Colorado', abbr: 'CO', seats: 8, chamber: 'federal-house', topo: topoOf('CO') }, await loadOgFonts());
    expect(files.map(([n]) => n)).toEqual(['badge.png', 'badge@2x.png', 'badge-dark.png', 'badge-dark@2x.png']);
    expect(pngWidth(files[0]![1])).toBe(300);
    expect(pngWidth(files[1]![1])).toBe(600);
  });
});

describe('committed state badges', () => {
  it.each([
    ['CO', 'Colorado', 'federal-house', 'CO'],
    ['CO', 'Colorado', 'state-senate', 'CO/state-senate'],
    ['AK', 'Alaska', 'federal-house', 'AK'],
    ['VT', 'Vermont', 'federal-house', 'VT'],
  ] as const)('%s %s %s match a fresh render', async (abbr, name, chamber, folder) => {
    const dir = join(process.cwd(), 'public', 'data', folder);
    const stats = JSON.parse(readFileSync(join(dir, 'stats.json'), 'utf8')) as { finished: { metrics: { seats: number } } };
    const files = stateBadgeFiles({ name, abbr, seats: stats.finished.metrics.seats, chamber, topo: topoOf(folder) }, await loadOgFonts());
    expect(files).toHaveLength(4);
    for (const [file, data] of files) expect(Buffer.compare(readFileSync(join(dir, file)), Buffer.from(data)), `${folder}/${file}`).toBe(0);
  });
});
