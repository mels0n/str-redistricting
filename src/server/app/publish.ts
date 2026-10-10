import { readFileSync } from 'node:fs';
import { publishData } from '../features/publish/index.js';
import { ReleaseConfigSchema, isPreRelease } from '../features/release/index.js';
import { parsePublishConfig } from '../shared/config/index.js';
import { exitCodeFor } from '../shared/errors/index.js';
import { listTags } from './git.js';

function tagsOrNone(): string[] {
  try {
    return listTags();
  } catch {
    return [];
  }
}

async function main(): Promise<void> {
  const cfg = parsePublishConfig(process.argv.slice(2));
  const release = ReleaseConfigSchema.parse(JSON.parse(readFileSync('config/release.json', 'utf8')));
  await publishData(cfg, isPreRelease(release, tagsOrNone()));
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(exitCodeFor(err));
});
