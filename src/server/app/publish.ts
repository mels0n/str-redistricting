import { readFileSync } from 'node:fs';
import { publishData } from '../features/publish/index.js';
import { ReleaseConfigSchema, isPreRelease } from '../features/release/index.js';
import { staleReason } from '../features/run-stamp/index.js';
import { parsePublishConfig } from '../shared/config/index.js';
import { exitCodeFor } from '../shared/errors/index.js';
import { listTags } from './git.js';
import { exploreCodeSha256, runKeyFor } from './run-key.js';

async function main(): Promise<void> {
  const cfg = parsePublishConfig(process.argv.slice(2));
  // The overlay and block-file modes read no plans, so they need no run stamp, release config or git.
  if (cfg.enactedOnly || cfg.blocksOnly) {
    await publishData(cfg, { planStale: async () => undefined });
    return;
  }
  // This reads the local working copy's config/release.json, which is the operator's own call. The check CI trusts
  // is the one in fingerprints.ts, which reads the base ref. A git failure propagates rather than opening the gate.
  const release = ReleaseConfigSchema.parse(JSON.parse(readFileSync('config/release.json', 'utf8')));
  const codeSha256 = exploreCodeSha256();
  await publishData(cfg, {
    planStale: (state, dir) => staleReason(dir, runKeyFor(state, codeSha256)),
    preRelease: isPreRelease(release, listTags()),
  });
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(exitCodeFor(err));
});
