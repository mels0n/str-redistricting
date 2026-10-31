import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { crestSvg, fixedBadgeFiles, frameSvg, loadOgFonts, pledgeSvg, sealSvg } from '../../src/server/features/publish/index.js';

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
