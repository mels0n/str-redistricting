import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadOgFonts, OG_PALETTE, ogCredit, ogSvg, renderOgPng } from '../../../src/server/features/publish/index.js';
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
    expect(svg).toContain('Fair House Maps');
    expect(svg).toContain('Testland &amp; Co: 2 districts');
    expect(svg).toContain('Maps release 1');
    expect(svg).toContain('01234567');
    expect(svg).toContain('width="1200"');
    expect(svg).toContain('height="630"');
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

describe('palette parity', () => {
  it('matches districtPalette in the client tokens', () => {
    const tokens = readFileSync(new URL('../../../src/client/shared/ui/tokens.ts', import.meta.url), 'utf8');
    const block = tokens.slice(tokens.indexOf('districtPalette'));
    const hexes = [...block.slice(0, block.indexOf('] as const')).matchAll(/hex: '(#[0-9A-Fa-f]{6})'/g)].map((m) => m[1]);
    expect([...OG_PALETTE]).toEqual(hexes);
  });
});
