import { notesRepo, type NotesRepo } from '../entities/signon-db/index.js';
import { readNotes } from '../features/notes/index.js';
import { loadEncryptionKey } from '../shared/config/backend.js';
import { handle } from './http.js';

export interface NotesHandlerDeps {
  repo: () => NotesRepo;
  encryptionKey: () => Buffer;
}

/** GET /api/notes?key=CO:us-house:03 or ?national=1. A read endpoint: it also works on previews. */
export function notesHandler(deps: NotesHandlerDeps): (req: Request) => Promise<Response> {
  return handle(async (req) => {
    const query = Object.fromEntries(new URL(req.url).searchParams);
    const body = await readNotes(query, deps.repo(), deps.encryptionKey());
    return Response.json(body, { headers: { 'cache-control': 'public, s-maxage=60, stale-while-revalidate=300' } });
  });
}

export const notesRoute = notesHandler({ repo: notesRepo, encryptionKey: () => loadEncryptionKey() });
