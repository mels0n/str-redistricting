// Vercel function: /api/remove. The handler lives in src/server/api and answers 405 to anything but POST.
export { removeRoute as POST, removeRoute as GET } from '../src/server/api/remove.js';
