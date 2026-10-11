import { CheckFailedError, exitCodeFor } from '../shared/errors/index.js';
import { parseLegislativeConfig } from '../shared/config/index.js';
import { countAll, formatCounts, readCountsText, writeCounts } from './legislative.js';

// `legislative:count` counts the districts in every pinned Census State House and State Senate file and writes
// config/legislative-districts.json. With `--check` it writes nothing and fails when the file differs from a fresh count.
async function main(): Promise<void> {
  const cfg = parseLegislativeConfig(process.argv.slice(2));
  const counts = await countAll(cfg.cacheDir, cfg.configDir);
  if (cfg.check) {
    if ((await readCountsText(cfg.configDir)) !== formatCounts(counts)) {
      throw new CheckFailedError('config/legislative-districts.json does not match the pinned Census files; run npm run legislative:count');
    }
    console.log('config/legislative-districts.json matches the pinned Census files');
    return;
  }
  await writeCounts(cfg.configDir, counts);
  console.log(`wrote ${Object.keys(counts.states).length} states to config/legislative-districts.json`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : 'legislative:count failed');
  process.exit(exitCodeFor(err));
});
