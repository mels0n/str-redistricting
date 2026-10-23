import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';
import { z } from 'zod';
// Imported from the file, not the publish slice's index, so the Vite config does not load the image renderer.
import { SITE_HOST, TAGLINE } from '../src/server/features/publish/site.js';

const SITE = `https://${SITE_HOST}`;

const ChamberSchema = z.object({ seats: z.number().int().nonnegative(), hasData: z.boolean() });

const IndexSchema = z.object({
  states: z.array(z.object({
    abbr: z.string().regex(/^[A-Z]{2}$/), name: z.string(), seats: z.number().int().positive(), hasData: z.boolean(),
    chambers: z.object({ 'state-house': ChamberSchema.optional(), 'state-senate': ChamberSchema.optional() }).optional(),
  })),
});

/** The state chambers, with the link segment and wording each uses. */
const CHAMBERS = [
  { key: 'state-house', segment: 'house', label: 'State House' },
  { key: 'state-senate', segment: 'senate', label: 'State Senate' },
] as const;

export type ShareChamber = (typeof CHAMBERS)[number]['key'];

export interface ShareEntry {
  readonly abbr: string;
  readonly name: string;
  readonly seats: number;
  /** A state chamber's page; absent for the federal House. */
  readonly chamber?: ShareChamber;
}

export const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Swap one tag of the shell for its new text; a shell without the tag is a build error, so an `index.html` edit cannot drop one silently. */
export function swap(shell: string, pattern: RegExp, replacement: string, what: string): string {
  if (!pattern.test(shell)) throw new Error(`share pages: the built index.html has no ${what} tag`);
  return shell.replace(pattern, () => replacement);
}

/** The app shell for one state's map, with that state's link-preview tags. It loads the viewer directly; no redirect. */
export function sharePageHtml(entry: ShareEntry, site: string, shell: string, hasImage = true): string {
  const name = esc(entry.name);
  const info = CHAMBERS.find((c) => c.key === entry.chamber);
  // The federal House keeps /CO and its original wording; a state chamber lives one folder deeper.
  const url = info === undefined ? `${site}/${entry.abbr}` : `${site}/${entry.abbr}/${info.segment}`;
  const image = hasImage ? `${site}/data/${info === undefined ? entry.abbr : `${entry.abbr}/${info.key}`}/og.png` : `${site}/og-image.png`;
  const title = info === undefined ? `${name}: districts drawn by Fair Maps` : `${name} ${info.label}: districts drawn by Fair Maps`;
  const kind = info === undefined ? 'congressional' : info.label;
  const description = `${name}'s ${entry.seats} ${kind} ${entry.seats === 1 ? 'district' : 'districts'}, drawn from 2020 Census counts by three fixed steps nobody can steer. ${TAGLINE}`;
  const alt = `${name}'s ${kind.toLowerCase()} districts drawn by Fair Maps.`;
  const meta = (attr: 'name' | 'property', key: string, value: string): [RegExp, string, string] =>
    [new RegExp(`<meta ${attr}="${key}" content="[^"]*" ?/?>`), `<meta ${attr}="${key}" content="${value}" />`, `${key} meta`];
  const swaps: [RegExp, string, string][] = [
    [/<title>[^<]*<\/title>/, `<title>${title}</title>`, 'title'],
    meta('name', 'description', description),
    [/<link rel="canonical" href="[^"]*" ?\/?>/, `<link rel="canonical" href="${url}" />`, 'canonical link'],
    meta('property', 'og:url', url),
    meta('property', 'og:title', title),
    meta('property', 'og:description', description),
    meta('property', 'og:image', image),
    meta('property', 'og:image:alt', alt),
  ];
  return swaps.reduce((html, [pattern, replacement, what]) => swap(html, pattern, replacement, what), shell);
}

/** Write `<distDir>/<ST>/index.html` for every state with published data, and `<ST>/house/` and `<ST>/senate/` for each state chamber that has data; returns the paths written. */
export function writeSharePages(publicDir: string, distDir: string): string[] {
  const indexPath = join(publicDir, 'data', 'index.json');
  if (!existsSync(indexPath)) return [];
  const parsed = IndexSchema.safeParse(JSON.parse(readFileSync(indexPath, 'utf8')));
  if (!parsed.success) throw new Error(`${indexPath} is not a valid index`);
  const shell = readFileSync(join(distDir, 'index.html'), 'utf8');
  const written: string[] = [];
  for (const s of parsed.data.states) {
    if (!s.hasData) continue;
    const dir = join(distDir, s.abbr);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'index.html'), sharePageHtml(s, SITE, shell, existsSync(join(publicDir, 'data', s.abbr, 'og.png'))));
    written.push(s.abbr);
    for (const c of CHAMBERS) {
      const own = s.chambers?.[c.key];
      if (own === undefined || !own.hasData || own.seats === 0) continue;
      const chamberDir = join(dir, c.segment);
      mkdirSync(chamberDir, { recursive: true });
      writeFileSync(join(chamberDir, 'index.html'), sharePageHtml({ ...s, seats: own.seats, chamber: c.key }, SITE, shell, existsSync(join(publicDir, 'data', s.abbr, c.key, 'og.png'))));
      written.push(`${s.abbr}/${c.segment}`);
    }
  }
  return written;
}

/** After the build, one share page per published state, so a link to /CO/ previews with that state's map. */
export function sharePages(): Plugin {
  let publicDir = 'public';
  let outDir = 'dist';
  return {
    name: 'share-pages',
    apply: 'build',
    configResolved(config) {
      publicDir = config.publicDir || 'public';
      outDir = join(config.root, config.build.outDir);
    },
    closeBundle() {
      writeSharePages(publicDir, outDir);
    },
  };
}
