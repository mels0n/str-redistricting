import { NotesResponseSchema, type PublicNote } from './model';

const TIMEOUT_MS = 4000;

/** Recent approved notes for one district key, or for the whole country; null on any error or after 4 seconds. It never throws. */
export async function loadNotes(scope: { key: string } | { national: true }): Promise<PublicNote[] | null> {
  try {
    const query = 'key' in scope ? `key=${encodeURIComponent(scope.key)}` : 'national=1';
    const res = await fetch(`/api/notes?${query}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return null;
    const parsed = NotesResponseSchema.safeParse(await res.json());
    return parsed.success ? parsed.data.notes : null;
  } catch {
    return null;
  }
}
