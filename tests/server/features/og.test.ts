import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadOgFonts, OG_PALETTE, ogCredit, ogSvg, renderOgPng } from '../../../src/server/features/publish/index.js';
import { TAGLINE } from '../../../src/server/features/publish/site.js';
import { stampOf, VERSIONS } from '../../../src/server/shared/config/index.js';

/** Two unit squares side by side, as quantized TopoJSON with a shared arc. */
const TOPO = JSON.stringify({
  type: 'Topology',
  transform: { scale: [0.1, 0.1], translate: [-100, 40] },
  objects: {
    districts: {
      type: 'GeometryCollection',
      geometries: [
        { type: 'Polygon', properties: { district: 2 }, arcs: [[1, 2]] },
        { type: 'Polygon', properties: { district: 1 }, arcs: [[0, -3]] },
      ],
    },
  },
  arcs: [
    [[10, 0], [-10, 0], [0, 10], [10, 0]],
    [[10, 0], [10, 0], [0, 10], [-10, 0]],
    [[10, 10], [0, -10]],
  ],
});

describe('ogCredit', () => {
  it('pins the full state credit line for CO', () => {
    const versions = { ...stampOf(VERSIONS), engine: '1.0.0', maps: 1 };
    expect(ogCredit({ abbr: 'CO', name: 'Colorado', versions, assignmentSha256: `eaffe5a8${'0'.repeat(56)}` })).toBe(
      'fairmaps.melson.us/CO · Colorado · Maps release 1 · engine 1.0.0 · eaffe5a8',
    );
  });
});

describe('ogSvg', () => {
  const credit = 'fairmaps.melson.us/XX · Testland · Maps release 1 · engine 1.0.0 · 01234567';
  const svg = ogSvg({ name: 'Testland & Co', abbr: 'XX', seats: 2, topo: TOPO, credit, palette: OG_PALETTE });

  it('draws both districts in different palette colors', () => {
    const fills = [...svg.matchAll(/<path[^>]* fill="(#[0-9A-Fa-f]{6})"/g)].map((m) => m[1]);
    expect(fills).toHaveLength(2);
    expect(new Set(fills).size).toBe(2);
    for (const f of fills) expect(OG_PALETTE.map((p) => p.toUpperCase())).toContain(f!.toUpperCase());
  });
  it('carries the headline, the escaped name with the district count, and the credit', () => {
    expect(svg).toContain('Fair Maps');
    expect(svg).toContain('Testland &amp; Co: 2 districts');
    expect(svg).toContain('Maps release 1');
    expect(svg).toContain('01234567');
    expect(svg).toContain('width="1200"');
    expect(svg).toContain('height="630"');
  });
  it('carries the tagline, wrapped to the column', () => {
    const lines = [...svg.matchAll(/font-size="34"[^>]*>([^<]*)</g)].map((m) => m[1]);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join(' ')).toBe(TAGLINE);
  });
  it('says 1 district for a single seat, and has no em dash', () => {
    const one = ogSvg({ name: 'Alaska', abbr: 'AK', seats: 1, topo: TOPO, credit, palette: OG_PALETTE });
    expect(one).toContain('Alaska: 1 district<');
    expect(svg).not.toContain('—');
  });
});

describe('renderOgPng', () => {
  it('returns a 1200x630 PNG', async () => {
    const svg = ogSvg({ name: 'Testland', abbr: 'XX', seats: 2, topo: TOPO, credit: 'fairmaps.melson.us/XX', palette: OG_PALETTE });
    const png = renderOgPng(svg, await loadOgFonts());
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
    expect(view.getUint32(16)).toBe(1200);
    expect(view.getUint32(20)).toBe(630);
  });
});

describe('fonts', () => {
  it('unpacks three valid TrueType fonts, and renders the same bytes every time', async () => {
    const fonts = await loadOgFonts();
    expect(fonts).toHaveLength(3);
    for (const f of fonts) expect([...f.subarray(0, 4)]).toEqual([0, 1, 0, 0]);
    const svg = ogSvg({ name: 'Testland', abbr: 'XX', seats: 2, topo: TOPO, credit: 'fairmaps.melson.us/XX', palette: OG_PALETTE });
    expect(Buffer.from(renderOgPng(svg, fonts)).equals(Buffer.from(renderOgPng(svg, await loadOgFonts())))).toBe(true);
  });
});

describe('ogSvg projection', () => {
  const square = (x: number, y: number, size: number) => [[x, y], [x, y + 4], [x + size, y + 4], [x + size, y], [x, y]];
  /** Two districts at both ends of an unwrapped frame (longitudes below -180), like the published Alaska. */
  const wide = JSON.stringify({
    type: 'Topology',
    objects: {
      districts: {
        type: 'GeometryCollection',
        geometries: [
          { type: 'Polygon', properties: { district: 1 }, arcs: [[0]] },
          { type: 'Polygon', properties: { district: 2 }, arcs: [[1]] },
        ],
      },
    },
    arcs: [square(-195, 52, 25), square(-140, 52, 10)],
  });
  it('fits a map that runs past -180 degrees across the map area instead of wrapping it', () => {
    const svg = ogSvg({ name: 'Wide', abbr: 'XX', seats: 2, topo: wide, credit: 'x', palette: OG_PALETTE });
    const spans = [...svg.matchAll(/<path d="([^"]*)"/g)].map((m) => {
      const xs = [...m[1]!.matchAll(/[ML]\s*(-?[0-9.]+)[ ,]/g)].map((n) => Number(n[1]));
      return { min: Math.min(...xs), max: Math.max(...xs) };
    });
    expect(spans).toHaveLength(2);
    const usable = 630 - 72;
    // The whole map is 65 degrees wide: the 25 degree district takes 25/65 of it, the 10 degree one 10/65 (a wrapped map shrinks both to a sliver).
    expect(Math.max(...spans.map((s) => s.max)) - Math.min(...spans.map((s) => s.min))).toBeGreaterThan(0.95 * usable);
    expect(spans[0]!.max - spans[0]!.min).toBeGreaterThan((25 / 65) * usable * 0.9);
    expect(spans[1]!.max - spans[1]!.min).toBeGreaterThan((10 / 65) * usable * 0.9);
  });
});

describe('font families', () => {
  it('the headline (weight 800) and the count (weight 600) render with different loaded faces, not one fallback', async () => {
    const fonts = await loadOgFonts();
    const svg = ogSvg({ name: 'Testland', abbr: 'XX', seats: 2, topo: TOPO, credit: 'fairmaps.melson.us/XX', palette: OG_PALETTE });
    const w800 = 'font-family="Public Sans" font-weight="800"';
    const w600 = 'font-family="Public Sans" font-weight="600"';
    expect(svg).toContain(w800);
    expect(svg).toContain(w600);
    const bytes = (s: string): Buffer => Buffer.from(renderOgPng(s, fonts));
    // Swapping a weight for the other changes the picture only when the two weights are different faces.
    expect(bytes(svg).equals(bytes(svg.replaceAll(w800, w600)))).toBe(false);
    expect(bytes(svg).equals(bytes(svg.replaceAll(w600, w800)))).toBe(false);
    // And the headline resolves to its loaded face rather than the renderer fallback. (The fallback for a missing
    // family lands on the 600 face, so the count cannot be checked this way; the swaps above cover it.)
    expect(bytes(svg).equals(bytes(svg.replaceAll(w800, 'font-family="Nonexistent Font"')))).toBe(false);
  });
});

describe('palette parity', () => {
  it('matches districtPalette in the client tokens', () => {
    const tokens = readFileSync(new URL('../../../src/client/shared/ui/tokens.ts', import.meta.url), 'utf8');
    const block = tokens.slice(tokens.indexOf('districtPalette'));
    const hexes = [...block.slice(0, block.indexOf('] as const')).matchAll(/hex: '(#[0-9A-Fa-f]{6})'/g)].map((m) => m[1]);
    expect([...OG_PALETTE]).toEqual(hexes);
  });
});
