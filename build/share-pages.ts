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

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A static page for one state's map: link-preview tags for crawlers, and a redirect to the map for people. No script. */
export function sharePageHtml(entry: ShareEntry, site: string, hasImage = true): string {
  const name = esc(entry.name);
  const info = CHAMBERS.find((c) => c.key === entry.chamber);
  // The federal House keeps /CO/ and its original wording; a state chamber lives one folder deeper.
  const path = info === undefined ? `${entry.abbr}/` : `${entry.abbr}/${info.segment}/`;
  const back = info === undefined ? '../' : '../../';
  const hash = info === undefined ? entry.abbr : `${entry.abbr}/${info.segment}`;
  const url = `${site}/${path}`;
  const image = hasImage ? `${site}/data/${info === undefined ? entry.abbr : `${entry.abbr}/${info.key}`}/og.png` : `${site}/og-image.png`;
  const title = info === undefined ? `${name}: districts drawn by Fair Maps` : `${name} ${info.label}: districts drawn by Fair Maps`;
  const kind = info === undefined ? 'congressional' : info.label;
  const description = `${name}'s ${entry.seats} ${kind} ${entry.seats === 1 ? 'district' : 'districts'}, drawn from 2020 Census counts by three fixed steps nobody can steer. ${TAGLINE}`;
  const alt = `${name}'s ${kind.toLowerCase()} districts drawn by Fair Maps.`;
  const label = info === undefined ? name : `${name} ${info.label}`;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <meta name="description" content="${description}" />
    <link rel="canonical" href="${url}" />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="${url}" />
    <meta property="og:site_name" content="Fair Maps" />
    <meta property="og:title" content="${title}" />
    <meta property="og:description" content="${description}" />
    <meta property="og:image" content="${image}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="${alt}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta http-equiv="refresh" content="0; url=${back}#/${hash}" />
  </head>
  <body>
    <p><a href="${back}#/${hash}">Open the ${label} map</a></p>
  </body>
</html>
`;
}

/** Write `<distDir>/<ST>/index.html` for every state with published data, and `<ST>/house/` and `<ST>/senate/` for each state chamber that has data; returns the paths written. */
export function writeSharePages(publicDir: string, distDir: string): string[] {
  const indexPath = join(publicDir, 'data', 'index.json');
  if (!existsSync(indexPath)) return [];
  const parsed = IndexSchema.safeParse(JSON.parse(readFileSync(indexPath, 'utf8')));
  if (!parsed.success) throw new Error(`${indexPath} is not a valid index`);
  const written: string[] = [];
  for (const s of parsed.data.states) {
    if (!s.hasData) continue;
    const dir = join(distDir, s.abbr);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'index.html'), sharePageHtml(s, SITE, existsSync(join(publicDir, 'data', s.abbr, 'og.png'))));
    written.push(s.abbr);
    for (const c of CHAMBERS) {
      const own = s.chambers?.[c.key];
      if (own === undefined || !own.hasData || own.seats === 0) continue;
      const chamberDir = join(dir, c.segment);
      mkdirSync(chamberDir, { recursive: true });
      writeFileSync(join(chamberDir, 'index.html'), sharePageHtml({ ...s, seats: own.seats, chamber: c.key }, SITE, existsSync(join(publicDir, 'data', s.abbr, c.key, 'og.png'))));
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
