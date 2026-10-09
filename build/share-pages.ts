import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';
import { z } from 'zod';
import { SITE_HOST } from '../src/server/features/publish/site.js';

const SITE = `https://${SITE_HOST}`;

const IndexSchema = z.object({
  states: z.array(z.object({ abbr: z.string().regex(/^[A-Z]{2}$/), name: z.string(), seats: z.number().int().positive(), hasData: z.boolean() })),
});

export interface ShareEntry {
  readonly abbr: string;
  readonly name: string;
  readonly seats: number;
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A static page for one state: link-preview tags for crawlers, and a redirect to the map for people. No script. */
export function sharePageHtml(entry: ShareEntry, site: string, hasImage = true): string {
  const name = esc(entry.name);
  const url = `${site}/${entry.abbr}/`;
  const image = hasImage ? `${site}/data/${entry.abbr}/og.png` : `${site}/og-image.png`;
  const title = `${name}: districts drawn by Fair House Maps`;
  const description = `${name}'s ${entry.seats} congressional ${entry.seats === 1 ? 'district' : 'districts'}, drawn from 2020 Census counts by three fixed steps nobody can steer.`;
  const alt = `${name}'s congressional districts drawn by Fair House Maps.`;
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
    <meta property="og:site_name" content="Fair House Maps" />
    <meta property="og:title" content="${title}" />
    <meta property="og:description" content="${description}" />
    <meta property="og:image" content="${image}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="${alt}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta http-equiv="refresh" content="0; url=../#/${entry.abbr}" />
  </head>
  <body>
    <p><a href="../#/${entry.abbr}">Open the ${name} map</a></p>
  </body>
</html>
`;
}

/** Write `<distDir>/<ST>/index.html` for every state with published data; returns the abbreviations written. */
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
