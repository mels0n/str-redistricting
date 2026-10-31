import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixedBadgeFiles, loadOgFonts } from '../features/publish/index.js';
import { exitCodeFor } from '../shared/errors/index.js';

const OUT_DIR = join(process.cwd(), 'public', 'badges');

async function main(): Promise<void> {
  const files = fixedBadgeFiles(await loadOgFonts());
  mkdirSync(OUT_DIR, { recursive: true });
  for (const name of readdirSync(OUT_DIR)) if (name.endsWith('.png') && !files.has(name)) rmSync(join(OUT_DIR, name));
  for (const [name, data] of files) writeFileSync(join(OUT_DIR, name), data);
  console.log(`wrote ${files.size} badge files to public/badges`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(exitCodeFor(err));
});
