import { describe, expect, it } from 'vitest';
import { notesHandler } from '../../../src/server/api/notes.js';
import type { NewNote, NoteRow, NoteScope, NotesRepo } from '../../../src/server/entities/signon-db/index.js';
import { buildDigest, normalizeForScreening, screenNote } from '../../../src/server/features/notes/index.js';
import { NOTE_RULES } from '../../../src/server/shared/config/note-rules.js';
import { seal } from '../../../src/server/shared/crypto/index.js';

const KEY = Buffer.alloc(32, 2);

describe('normalizeForScreening', () => {
  it.each([
    ['SH1T', 'shit'],
    ['$h!t', 'sh!t'],
    ['fuuuuck', 'fuck'],
    ['w w w.example', 'www.example'],
    ['b.a.d', 'bad'],
    ['ｆｕｃｋ', 'fuck'],
    ['fu​ck', 'fuck'],
    ['I passed class', 'i passed class'],
  ])('%s -> %s', (input, out) => {
    expect(normalizeForScreening(input)).toBe(out);
  });
});

describe('screenNote', () => {
  const reject = (reason: string) => ({ result: 'reject', reason });
  it.each([
    ['Fair lines for everyone', { result: 'pending', flags: [] }],
    ['see example.com', reject('links or handles')],
    ['see example dot com', reject('links or handles')],
    ['w w w.example', reject('links or handles')],
    ['visit https://x.test now', reject('links or handles')],
    ['follow @someone please', reject('links or handles')],
    ['call 303-555-0100', reject('phone numbers')],
    ['call (303) 555 0100', reject('phone numbers')],
    ['call 1 303 555 0100', reject('phone numbers')],
    ['me at gmail dot com', reject('email addresses')],
    ['me@gmail.com', reject('email addresses')],
    ['I live at 12 Main St', reject('street addresses')],
    ['this is sh1t', reject('words that aren’t allowed here')],
    ['what a $hit map', reject('words that aren’t allowed here')],
    ['f u c k them', reject('words that aren’t allowed here')],
    ['I passed class', { result: 'pending', flags: [] }],
    ['maps. Us people want fairness', { result: 'pending', flags: [] }],
    ['x'.repeat(281), reject('more than 280 characters')],
  ])('%s', (input, expected) => {
    expect(screenNote(input, NOTE_RULES)).toEqual(expected);
  });

  it('accepts exactly the maximum length', () => {
    expect(screenNote('a'.repeat(280), NOTE_RULES).result).toBe('pending');
  });

  it('flags party names and persuasion words, and a name in the middle of a sentence', () => {
    expect(screenNote('As a Republican I back this', NOTE_RULES)).toEqual({ result: 'pending', flags: ['republican'] });
    expect(screenNote('Time to vote against the mess', NOTE_RULES)).toEqual({ result: 'pending', flags: ['vote against'] });
    expect(screenNote('We should ask Jane Smith about it', NOTE_RULES)).toEqual({ result: 'pending', flags: ['mentions-person'] });
    expect(screenNote('Jane Smith knows. Maps matter', NOTE_RULES)).toEqual({ result: 'pending', flags: [] });
  });

  it('puts the first failing check ahead of later ones', () => {
    expect(screenNote('see example.com or call 303-555-0100', NOTE_RULES)).toEqual({ result: 'reject', reason: 'links or handles' });
  });

  it('blocks the slurs the project added, and no longer blocks the surnames cox and cok', () => {
    for (const w of ['kike', 'spic', 'gook', 'wetback', 'tranny', 'paki']) expect(screenNote(`they are ${w}`, NOTE_RULES)).toEqual({ result: 'reject', reason: 'words that aren’t allowed here' });
    expect(screenNote('Representative Cox listens', NOTE_RULES).result).toBe('pending');
    expect(screenNote('Mr Cok agrees', NOTE_RULES).result).toBe('pending');
  });

  it('keeps the rules file free of em dashes and the blocklist in place', () => {
    expect(JSON.stringify(NOTE_RULES)).not.toContain('—');
    expect(NOTE_RULES.blockWords.length).toBeGreaterThan(300);
    expect(NOTE_RULES.maxLength).toBe(280);
  });
});

/** An in-memory notes table that applies the same rules the database query does. */
class FakeNotes implements NotesRepo {
  rows: NoteRow[] = [];
  async insertNote(_n: NewNote) {}
  async removeNote(_id: string) {}
  async publicNotes(_scope: NoteScope, limit: number) {
    return this.rows.filter((r) => r.status === 'approved' && r.signerStatus === 'confirmed' && r.signerShowPublic).slice(0, limit);
  }
  async digestNotes() {
    return this.rows.filter((r) => r.status === 'approved' && r.shareWithRep && r.signerStatus === 'confirmed');
  }
  async signerCount() {
    return 7;
  }
}

const row = (over: Partial<NoteRow> & { body: string }): NoteRow => {
  const { body, ...rest } = over;
  return {
    bodyEnc: seal(body, KEY),
    status: 'approved',
    shareWithRep: false,
    createdAt: '2026-10-27T12:00:00Z',
    signerStatus: 'confirmed',
    signerShowPublic: true,
    nameEnc: seal('Maria G.', KEY),
    townEnc: seal('Boulder', KEY),
    ...rest,
  };
};

const get = (repo: NotesRepo, qs: string) => notesHandler({ repo: () => repo, encryptionKey: () => KEY })(new Request(`https://site.test/api/notes${qs}`));

describe('GET /api/notes', () => {
  it('returns approved notes of confirmed, show-public signers with name and town, and the counts cache header', async () => {
    const repo = new FakeNotes();
    repo.rows = [row({ body: 'Fair maps please' })];
    const res = await get(repo, '?key=CO:us-house:03');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, s-maxage=60, stale-while-revalidate=300');
    expect(await res.json()).toEqual({ notes: [{ body: 'Fair maps please', name: 'Maria G.', town: 'Boulder', at: '2026-10-27T12:00:00Z' }] });
  });

  it('leaves out a pending note, a note of a signer without show-public and of an unconfirmed signer', async () => {
    const repo = new FakeNotes();
    repo.rows = [
      row({ body: 'pending one', status: 'pending' }),
      row({ body: 'private one', signerShowPublic: false, shareWithRep: true }),
      row({ body: 'unconfirmed one', signerStatus: 'pending' }),
      row({ body: 'rejected one', status: 'rejected' }),
    ];
    expect(await (await get(repo, '?national=1')).json()).toEqual({ notes: [] });
  });

  it('does not trust the query: a row the database should have filtered out is still not published', async () => {
    const repo = new FakeNotes();
    repo.publicNotes = async () => [row({ body: 'pending', status: 'pending' }), row({ body: 'private', signerShowPublic: false })];
    expect(await (await get(repo, '?national=1')).json()).toEqual({ notes: [] });
  });

  it('limits to 10 and refuses a bad or missing scope', async () => {
    const repo = new FakeNotes();
    repo.rows = Array.from({ length: 14 }, (_, i) => row({ body: `note ${i}` }));
    expect(((await (await get(repo, '?national=1')).json()) as { notes: unknown[] }).notes).toHaveLength(10);
    for (const qs of ['', '?key=nope', '?national=1&key=CO:us-house:03', '?national=2', '?key=CO:us-house:03&x=1']) expect((await get(repo, qs)).status).toBe(400);
  });

  it('skips a note it cannot open instead of failing', async () => {
    const repo = new FakeNotes();
    repo.rows = [{ ...row({ body: 'x' }), bodyEnc: 'garbage' }, row({ body: 'good' })];
    expect(((await (await get(repo, '?national=1')).json()) as { notes: { body: string }[] }).notes.map((n) => n.body)).toEqual(['good']);
  });
});

describe('digest', () => {
  it('lists every approved note shared with the representative, including those of signers who did not tick show-public', async () => {
    const repo = new FakeNotes();
    repo.rows = [
      row({ body: 'Shared and public', shareWithRep: true }),
      row({ body: 'Shared but private', shareWithRep: true, signerShowPublic: false, nameEnc: null, townEnc: null }),
      row({ body: 'Not shared', shareWithRep: false }),
      row({ body: 'Pending shared', shareWithRep: true, status: 'pending' }),
    ];
    const md = await buildDigest('CO:us-house:03', repo, KEY);
    expect(md).toContain('# CO:us-house:03');
    expect(md).toContain('People who signed: 7');
    expect(md).toContain('"Shared and public" (Boulder)');
    expect(md).toContain('"Shared but private"');
    expect(md).not.toContain('Not shared');
    expect(md).not.toContain('Pending shared');
    // The private one is in the digest but not on the public endpoint.
    const pub = (await (await get(repo, '?key=CO:us-house:03')).json()) as { notes: { body: string }[] };
    expect(pub.notes.map((n) => n.body)).toEqual(['Shared and public', 'Not shared']);
  });

  it('refuses a malformed key', async () => {
    await expect(buildDigest('nope', new FakeNotes(), KEY)).rejects.toThrow();
  });
});
