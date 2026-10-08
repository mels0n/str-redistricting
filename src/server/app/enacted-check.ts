import { detectUpdate } from '../features/enacted/index.js';
import { boundaryUrl } from '../features/publish/index.js';
import { ENACTED_CONFIG } from '../shared/config/index.js';
import { exitCodeFor } from '../shared/errors/index.js';

// Prints one JSON line on stdout: {"update":false}, or {"update":true,"file":...,"congress":...,"year":...,"url":...}.
detectUpdate(ENACTED_CONFIG, new Date().getUTCFullYear(), boundaryUrl)
  .then((result) => {
    console.log(JSON.stringify(result));
  })
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(exitCodeFor(err));
  });
