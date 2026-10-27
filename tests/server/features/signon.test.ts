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
  async cleanup(rateBeforeIso: string, expiredBeforeIso: string, stuckBeforeIso: string) {
    this.cleanups++;
    if (this.failCleanup) throw new Error('db down');
    this.attempts = this.attempts.filter((a) => a.at.toISOString() >= rateBeforeIso);
    this.rows = this.rows.filter(
      (r) =>
        !(r.status === 'pending' && !this.queued.has(r.id) && ((r.tokenExpiresAt !== null && r.tokenExpiresAt < expiredBeforeIso) || (r.tokenExpiresAt === null && r.createdAt.toISOString() < stuckBeforeIso))),
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
const BODY = { address: `${STREET}, Denver CO`, email: 'ada@example.com', turnstileToken: 'tok', consentUpdates: true, showPublic: true, displayName: 'Ada L', ref: null, note: null };
const confirmReq = (token: string) => new Request('https://site.test/api/confirm', { method: 'POST', body: JSON.stringify({ token }) });
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
    await confirmHandler({ loadConfig: () => CONFIG, repo: () => repo, now: () => NOW })(confirmReq(sent[0]!.token));
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
      await confirmHandler({ loadConfig: () => CONFIG, repo: () => s.repo, now: () => NOW })(confirmReq(tokens.at(-1)!));
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
    const note = { note: 'call me on 303-555-0100' };
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

  it('cleans up old rate-limit rows and pending signers whose sent link expired over a week ago or whose email never went out over 9 days ago, keeps queued and recent ones, and runs once per 10 minutes', async () => {
    const s = setup();
    const ago = (days: number) => new Date(NOW.getTime() - days * 86_400_000);
    const row = (id: string, created: Date, exp: Date | null, status: 'pending' | 'confirmed' = 'pending'): Row => ({
      ...({} as PendingSigner), id, emailHash: id, status, tokenExpiresAt: exp ? exp.toISOString() : null, confirmedAt: null, createdAt: created,
    });
    s.repo.rows = [
      row('recent-queued', ago(1), null),
      row('stuck-recent', ago(5), null),
      row('old-never-sent', ago(20), null),
      row('old-never-sent-but-queued', ago(20), null),
      row('old-expired-long-ago', ago(30), ago(10)),
      row('old-expired-lately', ago(30), ago(3)),
      row('old-expired-but-queued', ago(30), ago(10)),
      row('old-confirmed', ago(60), null, 'confirmed'),
    ];
    s.repo.queued.add('old-expired-but-queued');
    s.repo.queued.add('old-never-sent-but-queued');
    s.repo.attempts = [{ ip: 'x', at: ago(2) }, { ip: 'x', at: NOW }];
    await s.handler(post(BODY));
    expect(s.repo.rows.map((r) => r.id).sort()).toEqual(['old-confirmed', 'old-expired-lately', 'old-expired-but-queued', 'old-never-sent-but-queued', 'stuck-recent', 's7', 'recent-queued'].sort());
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

  it('refuses the 6th try without recording it, so refused requests do not grow the table', async () => {
    const s = setup();
    for (let i = 0; i < 6; i++) await s.handler(post({ ...BODY, email: `r${i}@example.com` }));
    expect(s.repo.attempts).toHaveLength(5);
  });
});

describe('POST /api/confirm', () => {
  async function signed() {
    const s = setup();
    await s.handler(post(BODY));
    const confirm = confirmHandler({ loadConfig: () => CONFIG, repo: () => s.repo, now: () => NOW });
    return { ...s, confirm, token: s.sent[0]!.token };
  }

  it('confirms and answers the state as JSON, and a second call does the same without counting twice', async () => {
    const { confirm, token, repo } = await signed();
    for (let i = 0; i < 2; i++) {
      const res = await confirm(confirmReq(token));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: 'confirmed', state: 'CO' });
    }
    expect(repo.rows.filter((r) => r.status === 'confirmed')).toHaveLength(1);
    expect(repo.rows[0]!.confirmedAt).toBe(NOW.toISOString());
    expect(repo.rows[0]!.tokenHash).toBeTruthy();
  });

  it('answers 405 to GET and changes nothing, so a link scanner cannot confirm anyone', async () => {
    const { confirm, token, repo } = await signed();
    for (const method of ['GET', 'HEAD', 'PUT']) {
      const res = await confirm(new Request(`https://site.test/api/confirm?token=${token}`, { method }));
      expect(res.status).toBe(405);
      expect(res.headers.get('allow')).toBe('POST');
    }
    expect(repo.rows[0]!.status).toBe('pending');
  });

  it('answers 410 for an expired pending token and leaves the row pending', async () => {
    const { confirm, token, repo } = await signed();
    repo.rows[0]!.tokenExpiresAt = new Date(NOW.getTime() - 1000).toISOString();
    const res = await confirm(confirmReq(token));
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ error: 'token-expired' });
    expect(repo.rows[0]!.status).toBe('pending');
  });

  it('answers 400 for an unknown or malformed token or a body without one', async () => {
    const { confirm } = await signed();
    for (const req of [confirmReq('0'.repeat(64)), confirmReq('zz'), new Request('https://site.test/api/confirm', { method: 'POST', body: 'nope' }), new Request('https://site.test/api/confirm', { method: 'POST', body: '{}' })]) {
      const res = await confirm(req);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'token-invalid' });
    }
  });

  it('answers 503 when the database is down', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { confirm, token, repo } = await signed();
    repo.findByTokenHash = async () => { throw new Error('db down'); };
    expect((await confirm(confirmReq(token))).status).toBe(503);
  });

  it('answers 503 and touches nothing outside production', async () => {
    const repo = new FakeRepo();
    const res = await confirmHandler({ loadConfig: () => ({ vercelEnv: 'preview' }), repo: () => repo, now: () => NOW })(confirmReq('a'.repeat(64)));
    expect(res.status).toBe(503);
    expect(repo.touched).toBe(0);
  });
});

describe('POST /api/sign with a note', () => {
  const NOTE = 'Fair lines for everyone';

  it('stores a passing note sealed and pending, with the signer ticks, and still queues the email', async () => {
    const { handler, notes, sent, repo } = setup();
    const res = await handler(post({ ...BODY, note: NOTE }));
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ status: 'check-email', noteDropped: null, queued: false });
    expect(notes.stored).toHaveLength(1);
    const n = notes.stored[0]!;
    expect(n.bodyEnc.startsWith('v1:')).toBe(true);
    expect(n.bodyEnc).not.toContain(NOTE);
    expect(open(n.bodyEnc, KEY)).toBe(NOTE);
    expect(n).toMatchObject({ signerId: repo.rows[0]!.id, showPublic: true, flags: [], status: 'pending' });
    expect(sent).toHaveLength(1);
  });

  it('drops a failing note: 202 with the reason, the signer and email go ahead, nothing of the text is stored or logged', async () => {
    const { handler, notes, sent, repo } = setup();
    const res = await handler(post({ ...BODY, note: 'call me on 303-555-0100 about this' }));
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
    const res = await handler(post({ ...BODY, note: 'a b '.repeat(100) }));
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

describe('sign-up with just a state', () => {
  const { address: _a, ...NO_ADDRESS } = BODY;
  const STATE_ONLY = { ...NO_ADDRESS, address: null, state: 'CO' };
  const geocoded = (urls: string[]) => urls.filter((u) => u.startsWith('https://geocoding.geo.census.gov/'));

  it('stores state only, with null districts and town, and never calls the geocoder or the district files', async () => {
    const { handler, repo, sent, calls } = setup();
    const res = await handler(post(STATE_ONLY));
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ status: 'check-email', noteDropped: null, queued: false });
    expect(repo.rows).toHaveLength(1);
    expect(repo.rows[0]).toMatchObject({ status: 'pending', state: 'CO', usHouse: null, stateHouse: null, stateSenate: null, townEnc: null });
    expect(sent).toHaveLength(1);
    expect(geocoded(calls.urls)).toHaveLength(0);
    expect(calls.urls.some((u) => u.includes('/data/'))).toBe(false);
  });

  it('answers 400 when there is neither an address nor a state, or the state is not one of the 50', async () => {
    const { handler, repo } = setup();
    expect((await handler(post({ ...NO_ADDRESS, address: null }))).status).toBe(400);
    expect((await handler(post({ ...NO_ADDRESS, address: null, state: null }))).status).toBe(400);
    expect((await handler(post({ ...NO_ADDRESS }))).status).toBe(400);
    for (const state of ['ZZ', 'PR', 'DC', 'co', 'COL', '']) {
      expect((await handler(post({ ...STATE_ONLY, state }))).status).toBe(400);
      expect((await handler(post({ ...BODY, state }))).status).toBe(400);
    }
    expect(repo.rows).toHaveLength(0);
  });

  it('trusts the geocoder when an address and a different state are both given', async () => {
    const { handler, repo } = setup();
    expect((await handler(post({ ...BODY, state: 'TX' }))).status).toBe(202);
    expect(repo.rows[0]).toMatchObject({ state: 'CO', usHouse: '01', stateSenate: '07' });
  });

  it('keeps the address errors when an address is given with a state', async () => {
    const none = setup({}, { geocode: { result: { addressMatches: [] } } });
    const res = await none.handler(post({ ...BODY, state: 'CO' }));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'address-not-found' });
    const out = setup({}, { geocode: match('PR', 'San Juan') });
    expect(await (await out.handler(post({ ...BODY, state: 'CO' }))).json()).toEqual({ error: 'outside-states' });
  });

  it('still checks the bot check and the rate limit', async () => {
    const bot = setup({}, { turnstile: false });
    expect((await bot.handler(post(STATE_ONLY))).status).toBe(403);
    expect(bot.repo.rows).toHaveLength(0);
    const s = setup();
    for (let i = 0; i < 5; i++) expect((await s.handler(post({ ...STATE_ONLY, email: `a${i}@example.com` }))).status).toBe(202);
    expect((await s.handler(post({ ...STATE_ONLY, email: 'a6@example.com' }))).status).toBe(429);
  });

  it('answers a confirmed email exactly like a new one, and a dropped note the same way', async () => {
    for (const waiting of [false, true]) {
      const tokens: string[] = [];
      const s = setup({ enqueue: async (_k, _s, _t, token) => { tokens.push(token); return { queued: waiting }; } });
      wouldQueueNow = waiting;
      const note = { note: 'call me on 303-555-0100' };
      const fresh = await (await s.handler(post({ ...STATE_ONLY, email: 'new@example.com', ...note }))).text();
      await s.handler(post(STATE_ONLY));
      await confirmHandler({ loadConfig: () => CONFIG, repo: () => s.repo, now: () => NOW })(confirmReq(tokens.at(-1)!));
      const again = await s.handler(post({ ...STATE_ONLY, ...note }));
      expect(await again.text()).toBe(fresh);
      expect(again.status).toBe(202);
      expect(JSON.parse(fresh)).toEqual({ status: 'check-email', noteDropped: 'phone numbers', queued: waiting });
    }
  });

  it('seals the optional fields and confirms with the state', async () => {
    const { handler, repo, sent } = setup();
    await handler(post(STATE_ONLY));
    const stored = JSON.stringify(repo.rows);
    expect(stored).not.toContain('ada@example.com');
    expect(stored).not.toContain('Ada L');
    const res = await confirmHandler({ loadConfig: () => CONFIG, repo: () => repo, now: () => NOW })(confirmReq(sent[0]!.token));
    expect(await res.json()).toEqual({ status: 'confirmed', state: 'CO' });
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
