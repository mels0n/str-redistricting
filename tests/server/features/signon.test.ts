import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NewNote, NoteRow, NotesRepo, PendingSigner, SignerRepo, TokenRow } from '../../../src/server/entities/signon-db/index.js';
import { confirmHandler } from '../../../src/server/api/confirm.js';
import { signHandler, type SignHandlerDeps } from '../../../src/server/api/sign.js';
import { open } from '../../../src/server/shared/crypto/index.js';
import { clearDistrictCache, clientIp, resetCleanup, serverDistrictsAt } from '../../../src/server/features/signon/index.js';

const KEY = Buffer.alloc(32, 2);
const NOW = new Date('2026-10-27T15:00:00Z');
const CONFIG = { turnstileSecret: 'ts', hashSecret: Buffer.alloc(32, 1), encryptionKey: KEY, siteOrigin: 'https://site.test', vercelEnv: 'production' as string | undefined };

interface Row extends PendingSigner {
  id: string;
  status: 'pending' | 'confirmed';
  tokenExpiresAt: string | null;
  confirmedAt: string | null;
  createdAt: Date;
}

/** In-memory stand-in for the signon-db functions. */
class FakeRepo implements SignerRepo {
  rows: Row[] = [];
  attempts: { ip: string; at: Date }[] = [];
  touched = 0;
  async countAttempts(ip: string, sinceIso: string) {
    this.touched++;
    return this.attempts.filter((a) => a.ip === ip && a.at.toISOString() >= sinceIso).length;
  }
  async recordAttempt(ip: string) {
    this.touched++;
    this.attempts.push({ ip, at: NOW });
  }
  cleanups = 0;
  failCleanup = false;
  queued = new Set<string>();
  async cleanup(rateBeforeIso: string, expiredBeforeIso: string) {
    this.cleanups++;
    if (this.failCleanup) throw new Error('db down');
    this.attempts = this.attempts.filter((a) => a.at.toISOString() >= rateBeforeIso);
    this.rows = this.rows.filter(
      (r) => !(r.status === 'pending' && r.tokenExpiresAt !== null && r.tokenExpiresAt < expiredBeforeIso && !this.queued.has(r.id)),
    );
  }
  async isConfirmed(h: string) {
    this.touched++;
    return this.rows.some((r) => r.emailHash === h && r.status === 'confirmed');
  }
  async upsertPending(input: PendingSigner) {
    this.touched++;
    const existing = this.rows.find((r) => r.emailHash === input.emailHash);
    if (existing?.status === 'confirmed') return null;
    if (existing) {
      Object.assign(existing, input, { tokenExpiresAt: null });
      return { id: existing.id };
    }
    const id = `s${this.rows.length + 1}`;
    this.rows.push({ ...input, id, status: 'pending', tokenExpiresAt: null, confirmedAt: null, createdAt: NOW });
    return { id };
  }
  async findByTokenHash(h: string): Promise<TokenRow | null> {
    this.touched++;
    const r = this.rows.find((x) => x.tokenHash === h);
    return r ? { id: r.id, state: r.state, status: r.status, tokenExpiresAt: r.tokenExpiresAt } : null;
  }
  async confirm(id: string, at: string) {
    this.touched++;
    const r = this.rows.find((x) => x.id === id)!;
    r.status = 'confirmed';
    r.confirmedAt = at;
    r.tokenExpiresAt = null;
  }
}

/** In-memory stand-in for the notes table. */
class FakeNotes implements NotesRepo {
  stored: (NewNote & { status: string })[] = [];
  async insertNote(note: NewNote) {
    this.stored = this.stored.filter((n) => n.signerId !== note.signerId);
    this.stored.push({ ...note, status: 'pending' });
  }
  async removeNote(signerId: string) {
    this.stored = this.stored.filter((n) => n.signerId !== signerId);
  }
  async publicNotes(): Promise<NoteRow[]> {
    return [];
  }
  async digestNotes(): Promise<NoteRow[]> {
    return [];
  }
  async signerCount() {
    return 0;
  }
}

const topo = (code: string) => ({
  type: 'Topology',
  arcs: [[[-105, 39], [-104, 39], [-104, 40], [-105, 40], [-105, 39]]],
  objects: { enacted: { type: 'GeometryCollection', geometries: [{ type: 'Polygon', arcs: [[0]], properties: { code } }] } },
});

const match = (state = 'CO', city = 'Denver') => ({
  result: { addressMatches: [{ matchedAddress: '1 MAIN ST', coordinates: { x: -104.5, y: 39.5 }, addressComponents: { state, city } }] },
});

interface Calls { urls: string[] }
function stubFetch(opts: { turnstile?: boolean; geocode?: unknown } = {}): { fetchFn: typeof fetch; calls: Calls } {
  const calls: Calls = { urls: [] };
  const fetchFn = (async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    calls.urls.push(url);
    if (url.startsWith('https://challenges.cloudflare.com/')) return Response.json({ success: opts.turnstile ?? true });
    if (url.startsWith('https://geocoding.geo.census.gov/')) return Response.json(opts.geocode ?? match());
    if (url === 'https://site.test/data/CO/enacted.topo.json') return Response.json(topo('01'));
    if (url === 'https://site.test/data/CO/state-senate/enacted.topo.json') return Response.json(topo('07'));
    return new Response('', { status: 404 });
  }) as typeof fetch;
  return { fetchFn, calls };
}

const STREET = '1600 Secret Lane';
const BODY = { address: `${STREET}, Denver CO`, email: 'ada@example.com', turnstileToken: 'tok', consentUpdates: true, showPublic: true, displayName: 'Ada L', ref: null, note: null, shareWithRep: false };
const post = (body: unknown) => new Request('https://site.test/api/sign', { method: 'POST', body: JSON.stringify(body), headers: { 'x-forwarded-for': '9.9.9.9' } });

interface Sent { kind: string; signerId: string; to: string; token: string }
let wouldQueueNow = false;
function setup(over: Partial<SignHandlerDeps> = {}, fetchOpts: Parameters<typeof stubFetch>[0] = {}) {
  clearDistrictCache();
  resetCleanup();
  wouldQueueNow = false;
  const repo = new FakeRepo();
  const notes = new FakeNotes();
  const sent: Sent[] = [];
  const { fetchFn, calls } = stubFetch(fetchOpts);
  const deps: SignHandlerDeps = {
    loadConfig: () => CONFIG,
    repo: () => repo,
    notes: () => notes,
    enqueue: async (kind, signerId, to, token) => {
      sent.push({ kind, signerId, to, token });
      return { queued: false };
    },
    wouldQueue: async () => wouldQueueNow,
    fetchFn,
    now: () => NOW,
    ...over,
  };
  return { repo, notes, sent, calls, handler: signHandler(deps), deps };
}

beforeEach(() => void vi.spyOn(console, 'error').mockImplementation(() => {}));
afterEach(() => vi.restoreAllMocks());

describe('POST /api/sign', () => {
  it('stores one pending row, enqueues one email and does not echo the address', async () => {
    const { handler, repo, sent } = setup();
    const res = await handler(post(BODY));
    expect(res.status).toBe(202);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ status: 'check-email', noteDropped: null, queued: false });
    expect(text).not.toContain(STREET);
    expect(text).not.toContain('ada@example.com');
    expect(repo.rows).toHaveLength(1);
    expect(repo.rows[0]).toMatchObject({ status: 'pending', state: 'CO', usHouse: '01', stateHouse: null, stateSenate: '07', tokenExpiresAt: null });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe('ada@example.com');
    expect(sent[0]!.token).toMatch(/^[0-9a-f]{64}$/);
    expect(repo.rows[0]!.tokenHash).toBe(createHash('sha256').update(sent[0]!.token).digest('hex'));
    expect(JSON.stringify(repo.rows)).not.toContain(sent[0]!.token);
  });

  it('passes queued through from the outbox', async () => {
    const { handler } = setup({ enqueue: async () => ({ queued: true }) });
    expect(await (await handler(post(BODY))).json()).toMatchObject({ queued: true });
  });

  it('does nothing for an email that is already confirmed', async () => {
    const { handler, repo, sent } = setup();
    await handler(post(BODY));
    await confirmHandler({ loadConfig: () => CONFIG, repo: () => repo, now: () => NOW })(new Request(`https://site.test/api/confirm?token=${sent[0]!.token}`));
    sent.length = 0;
    const res = await handler(post(BODY));
    expect(res.status).toBe(202);
    expect(sent).toHaveLength(0);
    expect(repo.rows).toHaveLength(1);
    expect(repo.rows[0]!.status).toBe('confirmed');
  });

  it('answers 403 and writes nothing when the bot check fails', async () => {
    const { handler, repo, sent } = setup({}, { turnstile: false });
    const res = await handler(post(BODY));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'bot-check' });
    expect(repo.rows).toHaveLength(0);
    expect(repo.attempts).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  it('answers 429 on the sixth try in an hour', async () => {
    const { handler } = setup();
    for (let i = 0; i < 5; i++) expect((await handler(post({ ...BODY, email: `a${i}@example.com` }))).status).toBe(202);
    const res = await handler(post({ ...BODY, email: 'a6@example.com' }));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: 'rate-limit' });
  });

  it('answers 422 address-not-found when the geocoder has no match', async () => {
    const { handler, repo } = setup({}, { geocode: { result: { addressMatches: [] } } });
    const res = await handler(post(BODY));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'address-not-found' });
    expect(repo.rows).toHaveLength(0);
  });

  it('answers 422 outside-states for a Puerto Rico address', async () => {
    const { handler } = setup({}, { geocode: match('PR', 'San Juan') });
    const res = await handler(post(BODY));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'outside-states' });
  });

  it('answers 400 for a 255-character email, an unknown field and a non-JSON body', async () => {
    const { handler, repo } = setup();
    expect((await handler(post({ ...BODY, email: `${'a'.repeat(243)}@example.com` }))).status).toBe(400);
    expect((await handler(post({ ...BODY, extra: 1 }))).status).toBe(400);
    expect((await handler(new Request('https://site.test/api/sign', { method: 'POST', body: 'nope' }))).status).toBe(400);
    expect(repo.rows).toHaveLength(0);
  });

  it('never stores the street, and seals the optional fields', async () => {
    const { handler, repo } = setup();
    await handler(post(BODY));
    const stored = JSON.stringify(repo.rows);
    expect(stored).not.toContain('Secret');
    expect(stored).not.toContain(STREET);
    const r = repo.rows[0]!;
    for (const v of [r.emailEnc, r.displayNameEnc, r.townEnc]) expect(v).toMatch(/^v1:/);
    expect(stored).not.toContain('ada@example.com');
    expect(stored).not.toContain('Ada L');
    expect(stored).not.toContain('Denver');
  });

  it('leaves email_enc null without consent for updates', async () => {
    const { handler, repo } = setup();
    await handler(post({ ...BODY, consentUpdates: false, showPublic: false, displayName: null }));
    expect(repo.rows[0]).toMatchObject({ emailEnc: null, displayNameEnc: null, townEnc: null });
  });

  it('refreshes a pending signer instead of adding a row', async () => {
    const { handler, repo, sent } = setup();
    await handler(post(BODY));
    await handler(post(BODY));
    expect(repo.rows).toHaveLength(1);
    expect(sent).toHaveLength(2);
    expect(repo.rows[0]!.tokenHash).toBe(createHash('sha256').update(sent[1]!.token).digest('hex'));
  });

  it('answers 503 and touches nothing outside production', async () => {
    const { handler, repo, sent, calls } = setup({ loadConfig: () => ({ ...CONFIG, vercelEnv: 'preview' }) });
    const res = await handler(post(BODY));
    expect(res.status).toBe(503);
    expect(repo.touched).toBe(0);
    expect(sent).toHaveLength(0);
    expect(calls.urls).toHaveLength(0);
  });

  it('logs no address', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { handler } = setup({}, { turnstile: false });
    await handler(post(BODY));
    expect(log.mock.calls.flat().join(' ')).not.toContain('Secret');
  });
});

describe('sign-up hardening', () => {
  it('answers a confirmed email exactly like a new one, whether or not people are in line', async () => {
    for (const waiting of [false, true]) {
      const tokens: string[] = [];
      const s = setup({ enqueue: async (_k, _s, _t, token) => { tokens.push(token); return { queued: waiting }; } });
      wouldQueueNow = waiting;
      const fresh = await (await s.handler(post({ ...BODY, email: 'new@example.com' }))).text();
      await s.handler(post(BODY));
      await confirmHandler({ loadConfig: () => CONFIG, repo: () => s.repo, now: () => NOW })(new Request(`https://site.test/api/confirm?token=${tokens.at(-1)}`));
      const again = await s.handler(post(BODY));
      expect(await again.text()).toBe(fresh);
      expect(again.status).toBe(202);
      expect(JSON.parse(fresh).queued).toBe(waiting);
    }
  });

  it('answers a lost race like a new sign-up', async () => {
    const s = setup({ enqueue: async () => ({ queued: true }) });
    wouldQueueNow = true;
    s.repo.upsertPending = async () => null;
    const res = await s.handler(post(BODY));
    expect(await res.json()).toEqual({ status: 'check-email', noteDropped: null, queued: true });
    expect(s.sent).toHaveLength(0);
  });

  it('reports a dropped note the same way for a confirmed address, a lost race and a new sign-up', async () => {
    const note = { note: 'call me on 303-555-0100', shareWithRep: false };
    const s = setup();
    const fresh = await (await s.handler(post({ ...BODY, email: 'new@example.com', ...note }))).json();
    expect(fresh.noteDropped).toBe('phone numbers');
    await s.handler(post(BODY));
    for (const r of s.repo.rows) r.status = 'confirmed';
    const confirmed = await (await s.handler(post({ ...BODY, ...note }))).json();
    expect(confirmed).toEqual(fresh);
    const raceRepo = setup();
    raceRepo.repo.upsertPending = async () => null;
    expect(await (await raceRepo.handler(post({ ...BODY, ...note }))).json()).toEqual(fresh);
  });

  it('cleans up old rate-limit rows and pending signers whose sent link expired over a week ago, keeps every unsent one, and runs once per 10 minutes', async () => {
    const s = setup();
    const ago = (days: number) => new Date(NOW.getTime() - days * 86_400_000);
    const row = (id: string, created: Date, exp: Date | null, status: 'pending' | 'confirmed' = 'pending'): Row => ({
      ...({} as PendingSigner), id, emailHash: id, status, tokenExpiresAt: exp ? exp.toISOString() : null, confirmedAt: null, createdAt: created,
    });
    s.repo.rows = [
      row('recent-queued', ago(1), null),
      row('old-never-sent', ago(20), null),
      row('old-expired-long-ago', ago(30), ago(10)),
      row('old-expired-lately', ago(30), ago(3)),
      row('old-expired-but-queued', ago(30), ago(10)),
      row('old-confirmed', ago(60), null, 'confirmed'),
    ];
    s.repo.queued.add('old-expired-but-queued');
    s.repo.attempts = [{ ip: 'x', at: ago(2) }, { ip: 'x', at: NOW }];
    await s.handler(post(BODY));
    expect(s.repo.rows.map((r) => r.id).sort()).toEqual(['old-confirmed', 'old-expired-lately', 'old-expired-but-queued', 'old-never-sent', 's6', 'recent-queued'].sort());
    expect(s.repo.attempts.some((a) => a.at.getTime() === ago(2).getTime())).toBe(false);
    await s.handler(post({ ...BODY, email: 'b@example.com' }));
    expect(s.repo.cleanups).toBe(1);
  });

  it('never fails the request when cleanup fails', async () => {
    const s = setup();
    s.repo.failCleanup = true;
    expect((await s.handler(post(BODY))).status).toBe(202);
  });

  it('reads the client address from the platform header first', () => {
    const h = (o: Record<string, string>) => clientIp(new Headers(o));
    expect(h({ 'x-vercel-forwarded-for': '1.1.1.1', 'x-real-ip': '2.2.2.2', 'x-forwarded-for': '3.3.3.3, 4.4.4.4' })).toBe('1.1.1.1');
    expect(h({ 'x-real-ip': '2.2.2.2', 'x-forwarded-for': '3.3.3.3' })).toBe('2.2.2.2');
    expect(h({ 'x-forwarded-for': '3.3.3.3, 4.4.4.4' })).toBe('3.3.3.3');
    expect(h({})).toBe('unknown');
  });

  it('accepts only own-code characters in ref and cleans the display name', async () => {
    const s = setup();
    expect((await s.handler(post({ ...BODY, ref: 'ABCDEFGH' }))).status).toBe(400);
    expect((await s.handler(post({ ...BODY, ref: 'abcdefg0' }))).status).toBe(400);
    expect((await s.handler(post({ ...BODY, ref: 'abcdefgh', displayName: '  Ada \n\t  L\u0007ovelace\u200b ' }))).status).toBe(202);
    expect(open(s.repo.rows[0]!.displayNameEnc!, KEY)).toBe('Ada Lovelace');
    expect(s.repo.rows[0]!.refCode).toBe('abcdefgh');
  });

  it('records the attempt before counting, so the 6th try is refused and its row stays', async () => {
    const s = setup();
    for (let i = 0; i < 6; i++) await s.handler(post({ ...BODY, email: `r${i}@example.com` }));
    expect(s.repo.attempts).toHaveLength(6);
  });
});

describe('GET /api/confirm', () => {
  async function signed() {
    const s = setup();
    await s.handler(post(BODY));
    const confirm = confirmHandler({ loadConfig: () => CONFIG, repo: () => s.repo, now: () => NOW });
    const url = (t: string) => new Request(`https://site.test/api/confirm?token=${t}`);
    return { ...s, confirm, url, token: s.sent[0]!.token };
  }

  it('confirms and redirects, and a second click does the same without counting twice', async () => {
    const { confirm, url, token, repo } = await signed();
    for (let i = 0; i < 2; i++) {
      const res = await confirm(url(token));
      expect(res.status).toBe(303);
      expect(res.headers.get('location')).toBe('/CO?signed=1');
    }
    expect(repo.rows.filter((r) => r.status === 'confirmed')).toHaveLength(1);
    expect(repo.rows[0]!.confirmedAt).toBe(NOW.toISOString());
    expect(repo.rows[0]!.tokenHash).toBeTruthy();
  });

  it('redirects an expired pending token to the home page and leaves the row pending', async () => {
    const { confirm, url, token, repo } = await signed();
    repo.rows[0]!.tokenExpiresAt = new Date(NOW.getTime() - 1000).toISOString();
    const res = await confirm(url(token));
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/?signed=expired');
    expect(repo.rows[0]!.status).toBe('pending');
  });

  it('redirects an unknown or malformed token to the home page notice instead of answering JSON', async () => {
    const { confirm, url } = await signed();
    for (const req of [url('0'.repeat(64)), url('zz'), new Request('https://site.test/api/confirm')]) {
      const res = await confirm(req);
      expect(res.status).toBe(303);
      expect(res.headers.get('location')).toBe('/?signed=invalid');
    }
  });

  it('redirects to the same notice when the database is down', async () => {
    const { confirm, url, token, repo } = await signed();
    repo.findByTokenHash = async () => { throw new Error('db down'); };
    const res = await confirm(url(token));
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/?signed=invalid');
  });

  it('answers 503 and touches nothing outside production', async () => {
    const repo = new FakeRepo();
    const res = await confirmHandler({ loadConfig: () => ({ vercelEnv: 'preview' }), repo: () => repo, now: () => NOW })(new Request(`https://site.test/api/confirm?token=${'a'.repeat(64)}`));
    expect(res.status).toBe(503);
    expect(repo.touched).toBe(0);
  });
});

describe('POST /api/sign with a note', () => {
  const NOTE = 'Fair lines for everyone';

  it('stores a passing note sealed and pending, with the signer ticks, and still queues the email', async () => {
    const { handler, notes, sent, repo } = setup();
    const res = await handler(post({ ...BODY, note: NOTE, shareWithRep: true }));
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ status: 'check-email', noteDropped: null, queued: false });
    expect(notes.stored).toHaveLength(1);
    const n = notes.stored[0]!;
    expect(n.bodyEnc.startsWith('v1:')).toBe(true);
    expect(n.bodyEnc).not.toContain(NOTE);
    expect(open(n.bodyEnc, KEY)).toBe(NOTE);
    expect(n).toMatchObject({ signerId: repo.rows[0]!.id, showPublic: true, shareWithRep: true, flags: [], status: 'pending' });
    expect(sent).toHaveLength(1);
  });

  it('drops a failing note: 202 with the reason, the signer and email go ahead, nothing of the text is stored or logged', async () => {
    const { handler, notes, sent, repo } = setup();
    const res = await handler(post({ ...BODY, note: 'call me on 303-555-0100 about this', shareWithRep: true }));
    expect(res.status).toBe(202);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ status: 'check-email', noteDropped: 'phone numbers', queued: false });
    expect(text).not.toContain('555');
    expect(notes.stored).toHaveLength(0);
    expect(repo.rows).toHaveLength(1);
    expect(sent).toHaveLength(1);
    expect(JSON.stringify(repo.rows)).not.toContain('555');
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('555');
  });

  it('accepts a note longer than 280 characters and drops it for its length, not a 400', async () => {
    const { handler, notes } = setup();
    const res = await handler(post({ ...BODY, note: 'a b '.repeat(100), shareWithRep: false }));
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ noteDropped: 'more than 280 characters' });
    expect(notes.stored).toHaveLength(0);
    expect((await handler(post({ ...BODY, email: 'z@example.com', note: 'x'.repeat(2001) }))).status).toBe(400);
  });

  it('stores nothing for an empty note, and refuses a body without the new fields', async () => {
    const { handler, notes } = setup();
    expect((await handler(post({ ...BODY, note: '   ' }))).status).toBe(202);
    expect(notes.stored).toHaveLength(0);
    const { note: _n, ...without } = BODY;
    expect((await handler(post(without))).status).toBe(400);
  });

  it('replaces the earlier note when a pending signer signs again', async () => {
    const { handler, notes } = setup();
    await handler(post({ ...BODY, note: NOTE }));
    await handler(post({ ...BODY, note: 'Second thoughts on fairness' }));
    expect(notes.stored).toHaveLength(1);
    expect(open(notes.stored[0]!.bodyEnc, KEY)).toBe('Second thoughts on fairness');
  });
});

describe('re-signing with a pending note', () => {
  it.each([
    ['no note', null],
    ['an empty note', '   '],
    ['a note that fails screening', 'call 303-555-0100'],
  ])('removes the old pending note when the new sign-up has %s', async (_n, note) => {
    const { handler, notes } = setup();
    await handler(post({ ...BODY, note: 'Fair lines for everyone' }));
    expect(notes.stored).toHaveLength(1);
    expect((await handler(post({ ...BODY, note }))).status).toBe(202);
    expect(notes.stored).toHaveLength(0);
  });
});

describe('serverDistrictsAt', () => {
  it('reads the three files once per 10 minutes and gives null for a missing chamber', async () => {
    clearDistrictCache();
    const { fetchFn, calls } = stubFetch();
    let t = 0;
    const opts = { origin: 'https://site.test', fetchFn, now: () => t };
    expect(await serverDistrictsAt('CO', [-104.5, 39.5], opts)).toEqual({ usHouse: '01', stateHouse: null, stateSenate: '07' });
    expect(await serverDistrictsAt('CO', [-100, 39.5], opts)).toEqual({ usHouse: null, stateHouse: null, stateSenate: null });
    expect(calls.urls).toHaveLength(3);
    t = 11 * 60_000;
    await serverDistrictsAt('CO', [-104.5, 39.5], opts);
    expect(calls.urls).toHaveLength(6);
  });
});
