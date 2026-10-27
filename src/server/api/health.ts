import { ping } from '../entities/signon-db/index.js';
import { handle } from './http.js';

export const health = handle(async () => {
  await ping();
  return Response.json({ ok: true });
});
