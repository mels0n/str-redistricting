import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { removeHandler } from '../../../src/server/api/remove.js';
import { removeRequestHandler, type RemoveRequestHandlerDeps } from '../../../src/server/api/remove-request.js';
import type { RemovalRepo, RemovalToken, SignerRepo } from '../../../src/server/entities/signon-db/index.js';
import { hashEmail, TOKEN_PATTERN } from '../../../src/server/features/signon/hash.js';
import { renderEmail } from '../../../src/server/features/outbox/index.js';

const NOW = new Date('2026-10-27T15:00:00Z');
const SECRET = Buffer.alloc(32, 1);
const CONFIG = { turnstileSecret: 'ts', hashSecret: SECRET, vercelEnv: 'production' as string | undefined };
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

interface Row {
  id: string;
  emailHash: string;
  usHouse: string;
  removeTokenHash: string | null;
  removeExpires: string | null;
}

/** In-memory stand-in for the signers table: notes cascade, and the district count is derived from the rows. */
class FakeRemoval implements RemovalRepo {
  rows: Row[] = [{ id: 's1', emailHash: hashEmail('ada@example.com', SECRET), usHouse: '01', removeTokenHash: null, removeExpires: null }];
  notes = [{ signerId: 's1', text: 'hello' }];
  writes = 0;
  count = (code: string) => this.rows.filter((r) => r.usHouse === code).length;
  async setRemoveToken(emailHash: string, tokenHash: string) {
    const r = this.rows.find((x) => x.emailHash === emailHash);
    if (!r) return null;
    this.writes++;
    Object.assign(r, { removeTokenHash: tokenHash, removeExpires: null });
    return { id: r.id };
  }
  async findByRemoveTokenHash(h: string): Promise<RemovalToken | null> {
    const r = this.rows.find((x) => x.removeTokenHash === h);
    return r ? { id: r.id, expiresAt: r.removeExpires } : null;
  }
  async deleteSigner(id: string) {
    const n = this.rows.length;
    this.rows = this.rows.filter((r) => r.id !== id);
    this.notes = this.notes.filter((x) => x.signerId !== id);
    return this.rows.length < n;
  }
}

const rate = () => {
  const attempts: string[] = [];
  const repo = {
    async recordAttempt(ip: string) {
      attempts.push(ip);
    },
    async countAttempts(ip: string) {
      return attempts.filter((a) => a === ip).length;
    },
  } as unknown as SignerRepo;
  return { repo, attempts };
};

function setup(over: Partial<RemoveRequestHandlerDeps> = {}, turnstile = true) {
  const repo = new FakeRemoval();
  const { repo: rateRepo, attempts } = rate();
  const sent: { kind: string; signerId: string; to: string; token: string }[] = [];
  const deps: RemoveRequestHandlerDeps = {
    loadConfig: () => CONFIG,
    rateRepo: () => rateRepo,
    repo: () => repo,
    enqueue: async (kind, signerId, to, token) => {
      sent.push({ kind, signerId, to, token });
      return { queued: false };
    },
    fetchFn: (async () => Response.json({ success: turnstile })) as typeof fetch,
    now: () => NOW,
    ...over,
  };
  return { repo, sent, attempts, request: removeRequestHandler(deps), remove: removeHandler({ loadConfig: () => deps.loadConfig(), repo: () => repo, now: () => NOW }) };
}

const ask = (email: string) => new Request('https://site.test/api/remove-request', { method: 'POST', body: JSON.stringify({ email, turnstileToken: 'tok' }), headers: { 'x-forwarded-for': '9.9.9.9' } });
const del = (token: unknown) => new Request('https://site.test/api/remove', { method: 'POST', body: JSON.stringify({ token }) });

beforeEach(() => void vi.spyOn(console, 'error').mockImplementation(() => {}));
afterEach(() => vi.restoreAllMocks());

describe('POST /api/remove-request', () => {
  it('answers an unknown email exactly like a known one, sends nothing and changes no row', async () => {
    const known = setup();
    const unknown = setup();
    const a = await known.request(ask('ada@example.com'));
    const b = await unknown.request(ask('nobody@example.com'));
    expect(a.status).toBe(202);
    expect(b.status).toBe(202);
    expect(await a.json()).toEqual({ status: 'check-email' });
    expect(await b.json()).toEqual({ status: 'check-email' });
    expect(unknown.sent).toHaveLength(0);
    expect(unknown.repo.writes).toBe(0);
    expect(unknown.repo.rows[0]!.removeTokenHash).toBeNull();
  });

  it('for a known email sends one removal email and stores only the token hash', async () => {
    const { request, repo, sent } = setup();
    expect((await request(ask('Ada@Example.com'))).status).toBe(202);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: 'remove', signerId: 's1', to: 'Ada@Example.com' });
    expect(sent[0]!.token).toMatch(TOKEN_PATTERN);
    expect(repo.rows[0]!.removeTokenHash).toBe(sha(sent[0]!.token));
    expect(JSON.stringify(repo.rows)).not.toContain(sent[0]!.token);
    expect(repo.rows[0]!.removeExpires).toBeNull();
  });

  it('checks Turnstile first, rate limits in its own bucket, and refuses outside production', async () => {
    const bot = setup({}, false);
    expect((await bot.request(ask('ada@example.com'))).status).toBe(403);
    expect(bot.sent).toHaveLength(0);
    const s = setup();
    for (let i = 0; i < 5; i++) await s.request(ask('x@example.com'));
    expect((await s.request(ask('x@example.com'))).status).toBe(429);
    expect(s.attempts.every((a) => a === s.attempts[0])).toBe(true);
    const preview = setup({ loadConfig: () => ({ ...CONFIG, vercelEnv: 'preview' }) });
    expect((await preview.request(ask('ada@example.com'))).status).toBe(503);
    expect(preview.sent).toHaveLength(0);
    expect((await setup().request(ask('not an email'))).status).toBe(400);
  });
});

describe('POST /api/remove', () => {
  async function token(s: ReturnType<typeof setup>) {
    await s.request(ask('ada@example.com'));
    return s.sent[0]!.token;
  }

  it('deletes the signer and their notes, and the district count drops by one', async () => {
    const s = setup();
    const t = await token(s);
    expect(s.repo.count('01')).toBe(1);
    const res = await s.remove(del(t));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'removed' });
    expect(s.repo.rows).toHaveLength(0);
    expect(s.repo.notes).toHaveLength(0);
    expect(s.repo.count('01')).toBe(0);
  });

  it('gives 400 token-invalid for a second use, an unknown token and a malformed one', async () => {
    const s = setup();
    const t = await token(s);
    await s.remove(del(t));
    const again = await s.remove(del(t));
    expect(again.status).toBe(400);
    expect(await again.json()).toEqual({ error: 'token-invalid' });
    expect((await s.remove(del('a'.repeat(64)))).status).toBe(400);
    expect((await s.remove(del('nope'))).status).toBe(400);
    expect((await s.remove(del(5))).status).toBe(400);
  });

  it('gives 410 token-expired once the 48 hours are over, and keeps the row', async () => {
    const s = setup();
    const t = await token(s);
    s.repo.rows[0]!.removeExpires = new Date(NOW.getTime() - 1000).toISOString();
    const res = await s.remove(del(t));
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ error: 'token-expired' });
    expect(s.repo.rows).toHaveLength(1);
  });

  it('never deletes on a GET, and refuses writes outside production', async () => {
    const s = setup();
    const t = await token(s);
    const res = await s.remove(new Request(`https://site.test/api/remove?token=${t}`, { method: 'GET' }));
    expect(res.status).toBe(405);
    expect(s.repo.rows).toHaveLength(1);
    const preview = removeHandler({ loadConfig: () => ({ vercelEnv: 'preview' }), repo: () => s.repo, now: () => NOW });
    expect((await preview(del(t))).status).toBe(503);
    expect(s.repo.rows).toHaveLength(1);
  });
});

describe('removal plumbing', () => {
  it('the removal email links to the remove page with the token', () => {
    expect(renderEmail('remove', 'https://site.test/remove?token=abc', 'https://site.test').text).toContain('open this link and press Remove me:\n\nhttps://site.test/remove?token=abc');
  });

  it('migration 0004 adds the columns and starts the 48 hours when a remove email is sent', () => {
    const sql = readFileSync('supabase/migrations/0004_removal.sql', 'utf8');
    expect(sql).toContain('add column if not exists remove_token_hash text null');
    expect(sql).toContain('add column if not exists remove_token_expires_at timestamptz null');
    expect(sql).toContain('on signers (remove_token_hash) where remove_token_hash is not null');
    expect(sql).toContain('create or replace function mark_email_sent(p_id bigint)');
    expect(sql).toMatch(/elsif r\.kind = 'remove' then\s+update signers set remove_token_expires_at = sent_at_ts \+ interval '48 hours' where id = r\.signer_id/);
    expect(sql).toContain('revoke all on function mark_email_sent(bigint) from public, anon, authenticated');
  });
});
