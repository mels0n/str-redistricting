// Vercel function: POST /api/confirm (any other method answers 405). The handler lives in src/server/api.
export { confirmRoute as GET, confirmRoute as POST } from '../src/server/api/confirm.js';
