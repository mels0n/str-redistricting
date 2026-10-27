import { outboxRepo } from '../entities/signon-db/index.js';
import type { OutboxDeps } from '../features/outbox/index.js';
import { loadBackendConfig } from '../shared/config/backend.js';

/** The real outbox: the database, the backend config and the global fetch. */
export function outboxDeps(): OutboxDeps {
  const c = loadBackendConfig();
  return {
    repo: outboxRepo(),
    config: { resendApiKey: c.resendApiKey, from: c.from, siteOrigin: c.siteOrigin, encryptionKey: c.encryptionKey, emailDailyCap: c.emailDailyCap },
    fetchFn: (...args) => fetch(...args),
  };
}
