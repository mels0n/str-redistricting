// Vercel function: GET /api/cron-drain, called by the daily cron. The handler lives in src/server/api.
export { cronDrainRoute as GET } from '../src/server/api/cron-drain.js';
