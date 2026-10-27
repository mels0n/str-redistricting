import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PendingSigner, SignerRepo, TokenRow } from '../../../src/server/entities/signon-db/index.js';
import { confirmHandler } from '../../../src/server/api/confirm.js';
import { signHandler, type SignHandlerDeps } from '../../../src/server/api/sign.js';
import { clearDistrictCache, serverDistrictsAt } from '../../../src/server/features/signon/index.js';

const KEY = Buffer.alloc(32, 2);
const NOW = new Date('2026-10-27T15:00:00Z');
const CONFIG = { turnstileSecret: 'ts', hashSecret: Buffer.alloc(32, 1), encryptionKey: KEY, siteOrigin: 'https://site.test', vercelEnv: 'production' as string | undefined };

interface Row extends PendingSigner {
  id: string;
  status: 'pending' | 'confirmed';
  tokenExpiresAt: string | null;
  confirmedAt: string | null;
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
    this.rows.push({ ...input, id, status: 'pending', tokenExpiresAt: null, confirmedAt: null });
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
const BODY = { address: `${STREET}, Denver CO`, email: 'ada@example.com', turnstileToken: 'tok', consentUpdates: true, showPublic: true, displayName: 'Ada L', ref: null };
const post = (body: unknown) => new Request('https://site.test/api/sign', { method: 'POST', body: JSON.stringify(body), headers: { 'x-forwarded-for': '9.9.9.9' } });

interface Sent { kind: string; signerId: string; to: string; token: string }
function setup(over: Partial<SignHandlerDeps> = {}, fetchOpts: Parameters<typeof stubFetch>[0] = {}) {
  clearDistrictCache();
  const repo = new FakeRepo();
  const sent: Sent[] = [];
  const { fetchFn, calls } = stubFetch(fetchOpts);
  const deps: SignHandlerDeps = {
    loadConfig: () => CONFIG,
    repo: () => repo,
    enqueue: async (kind, signerId, to, token) => {
      sent.push({ kind, signerId, to, token });
      return { queued: false };
    },
    fetchFn,
    now: () => NOW,
    ...over,
  };
  return { repo, sent, calls, handler: signHandler(deps), deps };
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

  it('answers 400 for an unknown or malformed token', async () => {
    const { confirm, url } = await signed();
    expect((await confirm(url('0'.repeat(64)))).status).toBe(400);
    expect((await confirm(url('zz'))).status).toBe(400);
    expect((await confirm(new Request('https://site.test/api/confirm'))).status).toBe(400);
  });

  it('answers 503 and touches nothing outside production', async () => {
    const repo = new FakeRepo();
    const res = await confirmHandler({ loadConfig: () => ({ vercelEnv: 'preview' }), repo: () => repo, now: () => NOW })(new Request(`https://site.test/api/confirm?token=${'a'.repeat(64)}`));
    expect(res.status).toBe(503);
    expect(repo.touched).toBe(0);
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
