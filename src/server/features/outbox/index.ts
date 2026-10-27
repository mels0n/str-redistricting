export { drainOutbox } from './drain.js';
export { enqueueEmail, wouldQueue } from './enqueue.js';
export type { EmailKind } from './enqueue.js';
export { MAX_ATTEMPTS } from './send.js';
export type { OutboxConfig, OutboxDeps, SendResult } from './send.js';
export { renderEmail } from './templates.js';
