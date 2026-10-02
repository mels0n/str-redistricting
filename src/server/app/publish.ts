import { publishData } from '../features/publish/index.js';
import { parsePublishConfig } from '../shared/config/index.js';
import { exitCodeFor } from '../shared/errors/index.js';

publishData(parsePublishConfig(process.argv.slice(2))).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(exitCodeFor(err));
});
