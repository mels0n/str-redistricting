import { z } from 'zod';
import type { NoteRow, NoteScope, NotesRepo } from '../../entities/signon-db/index.js';
import { open } from '../../shared/crypto/index.js';
import { SignonError } from '../../shared/errors/signon.js';

/** `CO:state-house:012`: state, office, code. Mirrors the client's districtKey. */
const KEY = /^[A-Z]{2}:(us-house|us-senate|state-house|state-senate):[A-Za-z0-9-]{1,12}$/;

export const NotesQuerySchema = z
  .strictObject({ key: z.string().regex(KEY).optional(), national: z.literal('1').optional() })
  .refine((q) => (q.key === undefined) !== (q.national === undefined));

export const DigestKeySchema = z.string().regex(KEY);

export interface PublicNote {
  body: string;
  name: string | null;
  town: string | null;
  at: string;
}

export const PUBLIC_NOTES_LIMIT = 10;
const DIGEST_LIMIT = 1000;

const tryOpen = (sealed: string | null, key: Buffer): string | null => {
  if (sealed === null) return null;
  try {
    return open(sealed, key);
  } catch {
    return null;
  }
};

/** GET /api/notes. Only approved notes of confirmed signers who ticked show-public; name and town ride along for those signers only. */
export async function readNotes(query: unknown, repo: NotesRepo, encryptionKey: Buffer): Promise<{ notes: PublicNote[] }> {
  const parsed = NotesQuerySchema.safeParse(query);
  if (!parsed.success) throw new SignonError('bad-request');
  const scope: NoteScope = parsed.data.key ? { kind: 'district', key: parsed.data.key } : { kind: 'national' };
  const rows = await repo.publicNotes(scope, PUBLIC_NOTES_LIMIT);
  const notes: PublicNote[] = [];
  for (const r of rows.filter(isPublic).slice(0, PUBLIC_NOTES_LIMIT)) {
    const body = tryOpen(r.bodyEnc, encryptionKey);
    if (body === null) continue;
    notes.push({ body, name: tryOpen(r.nameEnc, encryptionKey), town: tryOpen(r.townEnc, encryptionKey), at: r.createdAt });
  }
  return { notes };
}

// The database query already filters; this keeps a mistake there from publishing a note.
const isPublic = (r: NoteRow): boolean => r.status === 'approved' && r.signerStatus === 'confirmed' && r.signerShowPublic;

/** The Markdown for one district: how many people signed, and the notes that are public on the site (the set /api/notes shows, without its limit of 10). */
export async function buildDigest(key: string, repo: NotesRepo, encryptionKey: Buffer): Promise<string> {
  if (!DigestKeySchema.safeParse(key).success) throw new SignonError('bad-request');
  const [count, rows] = await Promise.all([repo.signerCount(key), repo.publicNotes({ kind: 'district', key }, DIGEST_LIMIT)]);
  const lines = [`# ${key}`, '', `People who signed: ${count}`, ''];
  const shown = rows.filter(isPublic);
  if (shown.length === 0) lines.push('No notes are public yet.');
  for (const r of shown) {
    const body = tryOpen(r.bodyEnc, encryptionKey);
    if (body === null) continue;
    const town = tryOpen(r.townEnc, encryptionKey);
    lines.push(`- "${body.replace(/\s+/g, ' ')}"${town ? ` (${town})` : ''}`);
  }
  return `${lines.join('\n')}\n`;
}
