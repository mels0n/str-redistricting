import { OG_PALETTE, renderOgPng } from './og.js';

export type BadgeTheme = 'light' | 'dark';

/** CSS pixel sizes at 1x. The 2x files are double and the print files are scaled to 2000 pixels on the long side. */
export const BADGE_SIZES = {
  crest: { width: 160, height: 190 },
  seal: { width: 180, height: 180 },
  pledge: { width: 200, height: 150 },
  frame: { width: 1080, height: 1080 },
  state: { width: 300, height: 240 },
} as const satisfies Record<string, { width: number; height: number }>;

const GROUND = '#F3EFE5';
const INK = '#1A1915';
const SIGNAL = '#D88C0A';
const PRINT_LONG_SIDE = 2000;

/** Dark swaps ground and ink and keeps the amber. */
const colors = (t: BadgeTheme): { ground: string; ink: string } => (t === 'dark' ? { ground: INK, ink: GROUND } : { ground: GROUND, ink: INK });

const open = ({ width, height }: { width: number; height: number }): string => `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`;

const SANS = 'font-family="Public Sans"';

/** A shield holding the favicon's square and cut line, with an ink banner across it and the tagline below. */
export function crestSvg(t: BadgeTheme): string {
  const { ground, ink } = colors(t);
  return [
    open(BADGE_SIZES.crest),
    `<path d="M16 8H144V100C144 138 114 160 80 178C46 160 16 138 16 100Z" fill="${ground}" stroke="${ink}" stroke-width="5" stroke-linejoin="round"/>`,
    `<path d="M56 22H104V68H56Z" fill="none" stroke="${ink}" stroke-width="5.5"/>`,
    `<path d="M62 74 98 16" stroke="${SIGNAL}" stroke-width="7"/>`,
    `<rect x="4" y="78" width="152" height="34" fill="${ink}"/>`,
    `<text x="80" y="102" text-anchor="middle" ${SANS} font-weight="800" font-size="21" letter-spacing="1.2" fill="${ground}">FAIR MAPS</text>`,
    `<text x="80" y="136" text-anchor="middle" ${SANS} font-weight="600" font-size="13" fill="${ink}">Drawn by a rule</text>`,
    '</svg>',
  ].join('');
}

/** A hand-made, deliberately contorted district: arms, a hook and a pinched neck, drawn once and fixed. */
const CONTORTED_DISTRICT = 'M52 70L66 62L74 46L84 58L96 50L100 36L112 52L124 56L118 66L130 76L116 80L112 92L124 104L108 108L100 100L90 116L86 130L76 118L70 106L56 102L62 90L48 84Z';

/** Double-ring seal: a contorted district under an amber slash, with the words running round the ring. */
export function sealSvg(t: BadgeTheme): string {
  const { ground, ink } = colors(t);
  return [
    open(BADGE_SIZES.seal),
    `<circle cx="90" cy="90" r="86" fill="${ground}" stroke="${ink}" stroke-width="4"/>`,
    `<circle cx="90" cy="90" r="60" fill="none" stroke="${ink}" stroke-width="2"/>`,
    '<defs>',
    '<path id="top" d="M15.5 90A74.5 74.5 0 0 1 164.5 90"/>',
    '<path id="bottom" d="M10.5 90A79.5 79.5 0 0 0 169.5 90"/>',
    '</defs>',
    `<text ${SANS} font-weight="800" font-size="13.5" letter-spacing="1.6" fill="${ink}" text-anchor="middle"><textPath href="#top" startOffset="50%">END GERRYMANDERING</textPath></text>`,
    `<text ${SANS} font-weight="800" font-size="13.5" letter-spacing="3" fill="${ink}" text-anchor="middle"><textPath href="#bottom" startOffset="50%">FAIR MAPS</textPath></text>`,
    `<path d="${CONTORTED_DISTRICT}" fill="${OG_PALETTE[0]}" stroke="${ink}" stroke-width="2.5" stroke-linejoin="round"/>`,
    `<path d="M58 126 122 54" stroke="${ground}" stroke-width="13"/>`,
    `<path d="M58 126 122 54" stroke="${SIGNAL}" stroke-width="8"/>`,
    '</svg>',
  ].join('');
}

/** A card with a double frame, an amber check disc, the pledge and its second line. */
export function pledgeSvg(t: BadgeTheme): string {
  const { ground, ink } = colors(t);
  return [
    open(BADGE_SIZES.pledge),
    `<rect x="2" y="2" width="196" height="146" rx="10" fill="${ground}" stroke="${ink}" stroke-width="3"/>`,
    `<rect x="9" y="9" width="182" height="132" rx="5" fill="none" stroke="${ink}" stroke-width="1.2"/>`,
    `<circle cx="100" cy="43" r="19" fill="${SIGNAL}"/>`,
    `<path d="M90 43.5 97.5 51 111 35.5" fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`,
    `<text x="100" y="97" text-anchor="middle" ${SANS} font-weight="800" font-size="29" letter-spacing="1.5" fill="${ink}">I PLEDGE</text>`,
    `<text x="100" y="122" text-anchor="middle" ${SANS} font-weight="600" font-size="14" fill="${ink}">to support fair maps</text>`,
    '</svg>',
  ].join('');
}

/** A 1080 pixel amber ring for a profile photo: transparent middle and corners, the words round the bottom, the square and cut line at the top. */
export function frameSvg(): string {
  return [
    open(BADGE_SIZES.frame),
    `<path fill-rule="evenodd" fill="${SIGNAL}" d="M540 0A540 540 0 1 1 540 1080A540 540 0 1 1 540 0ZM540 100A440 440 0 1 0 540 980A440 440 0 1 0 540 100Z"/>`,
    `<circle cx="540" cy="540" r="437" fill="none" stroke="${INK}" stroke-width="6"/>`,
    '<defs><path id="ring" d="M15 540A525 525 0 0 0 1065 540"/></defs>',
    `<text ${SANS} font-weight="800" font-size="78" letter-spacing="10" fill="${INK}" text-anchor="middle"><textPath href="#ring" startOffset="50%">I SUPPORT FAIR MAPS</textPath></text>`,
    `<path d="M508 20H572V84H508Z" fill="none" stroke="${INK}" stroke-width="7"/>`,
    `<path d="M518 78 562 26" stroke="${GROUND}" stroke-width="9"/>`,
    '</svg>',
  ].join('');
}

/** Rasterize a badge to the given pixel width; the height follows the drawing's proportions. */
export function renderBadge(svg: string, width: number, fonts: readonly Uint8Array[]): Uint8Array {
  return renderOgPng(svg, fonts, width);
}

/** Every fixed badge file, keyed by its name under `public/badges/`. */
export function fixedBadgeFiles(fonts: readonly Uint8Array[]): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  const sized = (stem: string, size: { width: number; height: number }, svg: string): void => {
    files.set(`${stem}.png`, renderBadge(svg, size.width, fonts));
    files.set(`${stem}@2x.png`, renderBadge(svg, size.width * 2, fonts));
    files.set(`${stem}-print.png`, renderBadge(svg, Math.round((PRINT_LONG_SIDE * size.width) / Math.max(size.width, size.height)), fonts));
  };
  for (const t of ['light', 'dark'] as const) {
    const dark = t === 'dark' ? '-dark' : '';
    sized(`crest${dark}`, BADGE_SIZES.crest, crestSvg(t));
    sized(`seal${dark}`, BADGE_SIZES.seal, sealSvg(t));
    sized(`pledge${dark}`, BADGE_SIZES.pledge, pledgeSvg(t));
  }
  const frame = frameSvg();
  files.set('frame.png', renderBadge(frame, BADGE_SIZES.frame.width, fonts));
  files.set('frame-print.png', renderBadge(frame, PRINT_LONG_SIDE, fonts));
  return files;
}
