/**
 * Colors the map draws with. They mirror the CSS custom properties in
 * app/styles.css; MapLibre paint properties need literal values.
 */
/**
 * How much of the ground color covers the part of a district that lies over water. 1 would hide the district
 * color there; 0 would leave it as strong as land. The wash leaves the district's hue faintly showing.
 */
/** Also written as 70% in `.strv-legend__water::after` in app/styles.css; keep the two equal. */
export const WATER_VEIL = 0.7;

export const tokens = {
  ground: '#F3EFE5',
  paper: '#FBF9F4',
  ink: '#1A1915',
  ink2: '#5A554B',
  rule: '#8F887A',
  hairline: '#D6CFC0',
  quietFill: '#E4DED1',
  quietLine: '#FBF9F4',
  signal: '#D88C0A',
  signalInk: '#8A5200',
} as const;

/**
 * District fills: muted natural hues, none of them red or blue, chosen so
 * that ink text and borders keep at least 6.9:1 contrast on every one.
 * Neighboring districts never share a fill, and every district also carries
 * its number, so color is never the only way to tell districts apart.
 */
export const districtPalette = [
  { name: 'sand', hex: '#E2D2AE' },
  { name: 'sage', hex: '#AEBF94' },
  { name: 'heather', hex: '#BCA9C4' },
  { name: 'verdigris', hex: '#93BCAC' },
  { name: 'umber', hex: '#C9A783' },
  { name: 'rose stone', hex: '#D9B9AE' },
  { name: 'olive', hex: '#A3A672' },
  { name: 'slate', hex: '#B9B7AA' },
] as const;
