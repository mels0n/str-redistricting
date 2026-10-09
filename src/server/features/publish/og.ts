import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { geoMercator, geoPath } from 'd3-geo';
import { bbox, feature, neighbors } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import wawoff2 from 'wawoff2';
import { z } from 'zod';
import { DataError } from '../../shared/errors/index.js';

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;
const GROUND = '#F3EFE5';
const INK = '#1A1915';
const MAP_SIZE = 630;
const MAP_PAD = 36;
const COLUMN_X = 672;
const COLUMN_WIDTH = OG_WIDTH - COLUMN_X - 48;

/**
 * The district colors. A copy of `districtPalette` in the client tokens (the server never imports client code);
 * a test reads that file and fails if the two drift apart.
 */
export const OG_PALETTE = ['#E2D2AE', '#AEBF94', '#BCA9C4', '#93BCAC', '#C9A783', '#D9B9AE', '#A3A672', '#B9B7AA'] as const;

const TopoShape = z.looseObject({
  objects: z.looseObject({
    districts: z.looseObject({
      geometries: z.array(z.looseObject({ properties: z.looseObject({ district: z.number() }) })).min(1),
    }),
  }),
});

/** Same rule as the viewer: districts in number order, each takes the least-used slot none of its colored neighbors holds. */
function assignColors(adjacent: readonly (readonly number[])[], paletteSize: number): number[] {
  const slot = new Array<number>(adjacent.length).fill(-1);
  const used = new Array<number>(paletteSize).fill(0);
  adjacent.forEach((near, i) => {
    const taken = new Set(near.map((j) => slot[j]!).filter((s) => s >= 0));
    let best = -1;
    for (let c = 0; c < paletteSize; c++) if (!taken.has(c) && (best === -1 || used[c]! < used[best]!)) best = c;
    if (best === -1) best = i % paletteSize;
    slot[i] = best;
    used[best]!++;
  });
  return slot;
}

const escapeXml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Greedy wrap of the credit's parts (split at the middle dots) to a line width in monospaced characters. */
function wrapCredit(credit: string, maxChars: number): string[] {
  const lines: string[] = [];
  for (const part of credit.split(' · ')) {
    const last = lines[lines.length - 1];
    if (last !== undefined && last.length + 3 + part.length <= maxChars) lines[lines.length - 1] = `${last} · ${part}`;
    else lines.push(part);
  }
  return lines;
}

/** The 1200x630 link preview of a state: its districts on the left, the headline, count and credit on the right. */
export function ogSvg(p: { name: string; abbr: string; seats: number; topo: string; credit: string; palette: readonly string[] }): string {
  const parsed = TopoShape.safeParse(JSON.parse(p.topo));
  if (!parsed.success) throw new DataError(`${p.abbr}: districts topology is not usable for the preview image`);
  const topo = parsed.data as unknown as Topology;
  const collection = topo.objects['districts'] as GeometryCollection<{ district?: number }>;
  const number = (g: { properties?: object | null }): number => (g.properties as { district?: number } | null | undefined)?.district ?? 0;
  collection.geometries.sort((a, b) => number(a) - number(b));
  const slots = assignColors(neighbors(collection.geometries), p.palette.length);
  const features = feature(topo, collection);
  // Published frames can run past -180 degrees (Alaska); turn the globe so the state's center is the middle and nothing wraps.
  const [west, , east] = bbox(topo);
  const projection = geoMercator().rotate([-(west! + east!) / 2, 0]).fitExtent([[MAP_PAD, MAP_PAD], [MAP_SIZE - MAP_PAD, MAP_SIZE - MAP_PAD]], features);
  const toPath = geoPath(projection);
  const shapes = features.features
    .map((f, i) => `<path d="${toPath(f) ?? ''}" fill="${p.palette[slots[i]!]!}" stroke="${INK}" stroke-width="1.5" stroke-linejoin="round"/>`)
    .join('');

  const count = `${p.name}: ${p.seats} ${p.seats === 1 ? 'district' : 'districts'}`;
  const countSize = Math.min(40, Math.floor(COLUMN_WIDTH / (count.length * 0.58)));
  const creditLines = wrapCredit(p.credit, Math.floor(COLUMN_WIDTH / 9.8));
  const creditTop = OG_HEIGHT - 48 - (creditLines.length - 1) * 24;
  const credit = creditLines.map((l, i) => `<text x="${COLUMN_X}" y="${creditTop + i * 24}" font-family="IBM Plex Mono" font-size="16" fill="${INK}" fill-opacity="0.72">${escapeXml(l)}</text>`).join('');

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}">`,
    `<rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="${GROUND}"/>`,
    shapes,
    `<text x="${COLUMN_X}" y="196" font-family="Public Sans" font-weight="800" font-size="58" fill="${INK}">Fair House Maps</text>`,
    `<text x="${COLUMN_X}" y="260" font-family="Public Sans" font-weight="600" font-size="${countSize}" fill="${INK}">${escapeXml(count)}</text>`,
    credit,
    '</svg>',
  ].join('');
}

/** The static Public Sans files are cut from the variable font, so their name tables say family "Public Sans Thin" with the weight in the subfamily. The renderer matches the typographic family "Public Sans" plus font-weight (800 and 600 here); an unmatched name silently falls back to another face. */
const FONT_FILES = [
  '@fontsource/public-sans/files/public-sans-latin-800-normal.woff2',
  '@fontsource/public-sans/files/public-sans-latin-600-normal.woff2',
  '@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2',
] as const;

/** The preview image's fonts as TrueType data. The packages ship woff2, which the renderer cannot read, so it is unpacked here. */
export async function loadOgFonts(): Promise<Uint8Array[]> {
  const require = createRequire(import.meta.url);
  // One at a time: the decompressor shares one block of memory, so overlapping calls corrupt each other.
  const fonts: Uint8Array[] = [];
  for (const f of FONT_FILES) fonts.push(Buffer.from(await wawoff2.decompress(await readFile(require.resolve(f)))));
  return fonts;
}

/** Render the SVG to a PNG at 1200 pixels wide with only the given fonts (no system fonts, so every machine draws the same image). The renderer reads fonts from files, so they sit in a temporary folder for the call. */
export function renderOgPng(svg: string, fonts: readonly Uint8Array[]): Uint8Array {
  const dir = mkdtempSync(join(tmpdir(), 'og-fonts-'));
  try {
    const fontFiles = fonts.map((data, i) => {
      const path = join(dir, `font-${i}.ttf`);
      writeFileSync(path, data);
      return path;
    });
    return new Resvg(svg, { font: { fontFiles, loadSystemFonts: false }, fitTo: { mode: 'width', value: OG_WIDTH } }).render().asPng();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
