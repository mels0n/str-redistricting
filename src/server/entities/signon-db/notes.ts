import { db } from './client.js';

/** What the sign flow stores for a note that passed screening. The text is already sealed. */
export interface NewNote {
  signerId: string;
  bodyEnc: string;
  showPublic: boolean;
  flags: string[];
}

/** Where to look: one district, or the whole country. */
export type NoteScope = { kind: 'national' } | { kind: 'district'; key: string };

/** A note with the facts about its signer that decide whether it may be shown. Text, name and town are still sealed. */
export interface NoteRow {
  bodyEnc: string;
  status: string;
  createdAt: string;
  signerStatus: string;
  signerShowPublic: boolean;
  nameEnc: string | null;
  townEnc: string | null;
}

/** The data access for notes. Tests pass an in-memory implementation. */
export interface NotesRepo {
  /** Stores a pending note in one statement; a signer who signs again replaces their earlier note. */
  insertNote(note: NewNote): Promise<void>;
  /** Removes the signer's note, if any (signing again without a note, or with one that failed screening). */
  removeNote(signerId: string): Promise<void>;
  /** Approved notes of confirmed signers who ticked show-public, newest first. */
  publicNotes(scope: NoteScope, limit: number): Promise<NoteRow[]>;
  /** Confirmed signers in the district. */
  signerCount(key: string): Promise<number>;
}

const fail = (): never => {
  throw new Error('database error');
};

const COLUMNS = 'body_enc, status, created_at, signers!inner(status, show_public, display_name_enc, town_enc, state, us_house, state_house, state_senate)';

interface Joined {
  body_enc: string;
  status: string;
  created_at: string;
  signers: { status: string; show_public: boolean; display_name_enc: string | null; town_enc: string | null };
}

const toRow = (r: Joined): NoteRow => ({
  bodyEnc: r.body_enc,
  status: r.status,
  createdAt: r.created_at,
  signerStatus: r.signers.status,
  signerShowPublic: r.signers.show_public,
  nameEnc: r.signers.display_name_enc,
  townEnc: r.signers.town_enc,
});

const OFFICE_COLUMN = { 'us-house': 'us_house', 'state-house': 'state_house', 'state-senate': 'state_senate' } as const;

/** `CO:us-house:03` to the signers' columns that hold it. The U.S. Senate seats are statewide: every signer in the state. */
function districtFilter(key: string): { state: string; column: string | null; code: string } {
  const [state = '', office = '', code = ''] = key.split(':');
  return { state, column: OFFICE_COLUMN[office as keyof typeof OFFICE_COLUMN] ?? null, code };
}

export function notesRepo(): NotesRepo {
  return {
    async insertNote(note) {
      const { error } = await db()
        .from('notes')
        .upsert(
          {
            signer_id: note.signerId,
            body_enc: note.bodyEnc,
            show_public: note.showPublic,
            status: 'pending',
            flags: note.flags,
            created_at: new Date().toISOString(),
            reviewed_at: null,
          },
          { onConflict: 'signer_id' },
        );
      if (error) fail();
    },
    async removeNote(signerId) {
      const { error } = await db().from('notes').delete().eq('signer_id', signerId);
      if (error) fail();
    },
    async publicNotes(scope, limit) {
      let q = db().from('notes').select(COLUMNS).eq('status', 'approved').eq('show_public', true).eq('signers.status', 'confirmed').eq('signers.show_public', true);
      if (scope.kind === 'district') {
        const f = districtFilter(scope.key);
        q = q.eq('signers.state', f.state);
        if (f.column) q = q.eq(`signers.${f.column}`, f.code);
      }
      const { data, error } = await q.order('created_at', { ascending: false }).limit(limit);
      if (error) fail();
      return ((data ?? []) as unknown as Joined[]).map(toRow);
    },
    async signerCount(key) {
      const f = districtFilter(key);
      let q = db().from('signers').select('id', { count: 'exact', head: true }).eq('status', 'confirmed').eq('state', f.state);
      if (f.column) q = q.eq(f.column, f.code);
      const { count, error } = await q;
      if (error) fail();
      return count ?? 0;
    },
  };
}
