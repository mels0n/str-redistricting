import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { districtShapes, OG_PALETTE } from '../../../src/server/features/publish/index.js';

const BOX: [[number, number], [number, number]] = [[10, 10], [290, 170]];
const load = (abbr: string): string => readFileSync(`public/data/${abbr}/districts.topo.json`, 'utf8');
const draw = (abbr: string): string => districtShapes({ abbr, topo: load(abbr), palette: OG_PALETTE, box: BOX, stroke: '#000', strokeWidth: 1 });
const numbers = (svg: string): number[] => [...svg.matchAll(/ d="([^"]*)"/g)].flatMap((m) => (m[1]!.match(/-?\d+(?:\.\d+)?(?:e[-+]?\d+)?/g) ?? []).map(Number));

describe('districtShapes', () => {
  it('draws one path per district inside the box', () => {
    const svg = draw('CO');
    expect(svg.match(/<path/g)).toHaveLength(8);
    for (const m of svg.matchAll(/fill="([^"]*)"/g)) expect(OG_PALETTE).toContain(m[1]);
    const n = numbers(svg);
    for (let i = 0; i < n.length; i += 2) {
      expect(n[i]!).toBeGreaterThanOrEqual(9.5);
      expect(n[i]!).toBeLessThanOrEqual(290.5);
      expect(n[i + 1]!).toBeGreaterThanOrEqual(9.5);
      expect(n[i + 1]!).toBeLessThanOrEqual(170.5);
    }
  });

  it('turns Alaska so it is not split', () => {
    const n = numbers(draw('AK'));
    const xs = n.filter((_, i) => i % 2 === 0);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(280);
  });
});
