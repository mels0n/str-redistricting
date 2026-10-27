import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cronDrainHandler } from '../../../src/server/api/cron-drain.js';
import type { EmailKind, OutboxRepo, OutboxRow } from '../../../src/server/entities/signon-db/index.js';
import { drainOutbox, enqueueEmail, renderEmail, type OutboxDeps } from '../../../src/server/features/outbox/index.js';
import { open } from '../../../src/server/shared/crypto/index.js';

const KEY = Buffer.alloc(32, 2);
const SITE = 'https://site.test';

interface Stored extends Omit<OutboxRow, 'toEnc' | 'tokenEnc'> {
  status: 'queued' | 'sent' | 'failed';
  sentAt: Date | null;
  toEnc: string | null;
  tokenEnc: string | null;
}

/**
 * In-memory stand-in for the outbox tables and functions. `claimSlot` applies the same conditional update as
 * claim_email_slot (`sent = sent + 1 where day = today and sent < cap`), serialised by a lock the way the row lock
 * serialises concurrent callers in Postgres. It is not real Postgres.
 */
class FakeOutbox implements OutboxRepo {
  rows: Stored[] = [];
  days = new Map<string, number>();
  expiry = new Map<string, Date>();
  today = '2026-10-27';
  clock = new Date('2026-10-27T15:00:00Z');
  private nextId = 1;
  private lock: Promise<void> = Promise.resolve();

  async upsertQueued(kind: EmailKind, signerId: string, toEnc: string, tokenEnc: string): Promise<OutboxRow> {
    const waiting = this.rows.find((r) => r.signerId === signerId && r.kind === kind && r.status === 'queued');
    if (waiting) {
      Object.assign(waiting, { toEnc, tokenEnc, attempts: 0 });
      return { ...waiting } as OutboxRow;
    }
    const row: Stored = { id: this.nextId++, kind, signerId, toEnc, tokenEnc, attempts: 0, status: 'queued', sentAt: null };
    this.rows.push(row);
    return { ...row } as OutboxRow;
  }
  async hasQueuedAhead(row: OutboxRow) {
    return this.rows.some((r) => r.status === 'queued' && r.id !== row.id && (row.kind === 'remove' ? r.kind === 'remove' && r.id < row.id : r.kind === 'remove' || r.id < row.id));
  }
  private queuedInOrder(): Stored[] {
    return this.rows.filter((r) => r.status === 'queued').sort((a, b) => Number(b.kind === 'remove') - Number(a.kind === 'remove') || a.id - b.id);
  }
  async listQueued(limit: number) {
    return this.queuedInOrder().slice(0, limit).map((r) => ({ ...r }) as OutboxRow);
  }
  async countQueued() {
    return this.queuedInOrder().length;
  }
  async claimSlot(cap: number) {
    const prev = this.lock;
    let release!: () => void;
    this.lock = new Promise<void>((r) => (release = r));
    await prev;
    try {
      await Promise.resolve();
      const sent = this.days.get(this.today) ?? 0;
      if (sent >= cap) return false;
      this.days.set(this.today, sent + 1);
      return true;
    } finally {
      release();
    }
  }
  async releaseSlot() {
    const sent = this.days.get(this.today) ?? 0;
    if (sent > 0) this.days.set(this.today, sent - 1);
  }
  async markSent(id: number) {
    const r = this.rows.find((x) => x.id === id && x.status === 'queued');
    if (!r) return;
    Object.assign(r, { status: 'sent', sentAt: this.clock, toEnc: null, tokenEnc: null });
    if (r.kind === 'confirm') this.expiry.set(r.signerId, new Date(this.clock.getTime() + 48 * 3_600_000));
  }
  async recordFailure(row: OutboxRow, maxAttempts: number) {
    const r = this.rows.find((x) => x.id === row.id)!;
    r.attempts = row.attempts + 1;
    if (r.attempts >= maxAttempts) r.status = 'failed';
  }
}

interface Mail { to: string; subject: string; text: string; auth: string | null }
function setup(opts: { cap?: number; failResend?: () => boolean } = {}) {
  const repo = new FakeOutbox();
  const mails: Mail[] = [];
  const fetchFn = (async (_url: unknown, init: RequestInit) => {
    if (opts.failResend?.()) return new Response('{}', { status: 500 });
    const body = JSON.parse(String(init.body)) as { to: string[]; subject: string; text: string };
    mails.push({ to: body.to[0]!, subject: body.subject, text: body.text, auth: new Headers(init.headers).get('authorization') });
    return Response.json({ id: 'x' });
  }) as typeof fetch;
  const deps: OutboxDeps = {
    repo,
    config: { resendApiKey: 'rk', from: 'Fair Maps <a@b.test>', siteOrigin: SITE, encryptionKey: KEY, emailDailyCap: opts.cap ?? 20 },
    fetchFn,
  };
  return { repo, mails, deps };
}

beforeEach(() => void vi.spyOn(console, 'error').mockImplementation(() => {}));
afterEach(() => vi.restoreAllMocks());

describe('enqueueEmail', () => {
  it('sends 20 of 25 sign-ups on one day and leaves 5 queued', async () => {
    const { repo, mails, deps } = setup();
    const answers: boolean[] = [];
    for (let i = 0; i < 25; i++) answers.push((await enqueueEmail(deps, 'confirm', `s${i}`, `p${i}@example.com`, `tok${i}`)).queued);
    expect(answers.slice(0, 20).every((q) => q === false)).toBe(true);
    expect(answers.slice(20).every((q) => q === true)).toBe(true);
    expect(mails).toHaveLength(20);
    expect(repo.rows.filter((r) => r.status === 'queued')).toHaveLength(5);
    expect(mails[0]!.auth).toBe('Bearer rk');
  });

  it('queues a new sign-up behind waiting rows even when today has room', async () => {
    const { repo, mails, deps } = setup({ cap: 1 });
    await enqueueEmail(deps, 'confirm', 's1', 'a@example.com', 't1');
    await enqueueEmail(deps, 'confirm', 's2', 'b@example.com', 't2');
    repo.today = '2026-10-28';
    // Room today, but s2 is waiting: s3 must not jump ahead.
    const r = await enqueueEmail(deps, 'confirm', 's3', 'c@example.com', 't3');
    expect(r.queued).toBe(true);
    expect(mails).toHaveLength(1);
    expect((await drainOutbox(deps, 20)).left).toBe(0);
    expect(mails.map((m) => m.to)).toEqual(['a@example.com', 'b@example.com', 'c@example.com']);
    // The queue is empty now, so the next sign-up goes out at once.
    repo.today = '2026-10-29';
    expect((await enqueueEmail(deps, 'confirm', 's4', 'd@example.com', 't4')).queued).toBe(false);
  });

  it('keeps one waiting row per signer and uses the newest token', async () => {
    const { repo, mails, deps } = setup({ cap: 0 });
    await enqueueEmail(deps, 'confirm', 's1', 'a@example.com', 'old');
    await enqueueEmail(deps, 'confirm', 's1', 'a@example.com', 'new');
    expect(repo.rows).toHaveLength(1);
    expect(open(repo.rows[0]!.tokenEnc!, KEY)).toBe('new');
    expect(mails).toHaveLength(0);
  });

  it('stores the address and token sealed', async () => {
    const { repo, deps } = setup({ cap: 0 });
    await enqueueEmail(deps, 'confirm', 's1', 'ada@example.com', 'secret-token');
    const stored = JSON.stringify(repo.rows);
    expect(stored).not.toContain('ada@example.com');
    expect(stored).not.toContain('secret-token');
    expect(repo.rows[0]!.toEnc).toMatch(/^v1:/);
  });
});

describe('claim_email_slot semantics', () => {
  it('30 concurrent claims with cap 20 succeed exactly 20 times (fake with the same conditional update under a lock)', async () => {
    const { repo } = setup();
    const results = await Promise.all(Array.from({ length: 30 }, () => repo.claimSlot(20)));
    expect(results.filter(Boolean)).toHaveLength(20);
  });

  it('the migration claims with a conditional update on today in America/Chicago', () => {
    const sql = readFileSync('supabase/migrations/0002_outbox.sql', 'utf8');
    expect(sql).toContain("(now() at time zone 'America/Chicago')::date");
    expect(sql).toMatch(/update email_days set sent = sent \+ 1 where day = today and sent < cap returning true/);
    expect(sql).toContain('alter table email_outbox enable row level security');
    expect(sql).toContain('alter table email_days enable row level security');
    expect(sql).not.toMatch(/create policy/i);
  });
});

describe('drainOutbox', () => {
  it('sends the queued rows oldest first the next day, with removals ahead of older confirmations', async () => {
    const { repo, mails, deps } = setup({ cap: 2 });
    for (let i = 0; i < 4; i++) await enqueueEmail(deps, 'confirm', `s${i}`, `c${i}@example.com`, `t${i}`);
    await enqueueEmail(deps, 'remove', 'r1', 'rem@example.com', 'rt');
    expect(mails).toHaveLength(2);
    repo.today = '2026-10-28';
    expect(await drainOutbox(deps, 2)).toEqual({ sent: 2, left: 1 });
    expect(mails.slice(2).map((m) => m.to)).toEqual(['rem@example.com', 'c2@example.com']);
    repo.today = '2026-10-29';
    expect(await drainOutbox(deps, 2)).toEqual({ sent: 1, left: 0 });
    expect(mails[4]!.to).toBe('c3@example.com');
  });

  it('stops when the quota is used up', async () => {
    const { deps } = setup({ cap: 3 });
    for (let i = 0; i < 5; i++) await enqueueEmail(deps, 'confirm', `s${i}`, `c${i}@example.com`, `t${i}`);
    expect(await drainOutbox(deps, 3)).toEqual({ sent: 0, left: 2 });
  });
});

describe('after a send', () => {
  it('drops the sealed address and token and sets the signer expiry 48 hours after sent_at', async () => {
    const { repo, deps } = setup();
    await enqueueEmail(deps, 'confirm', 's1', 'a@example.com', 't1');
    const row = repo.rows[0]!;
    expect(row).toMatchObject({ status: 'sent', toEnc: null, tokenEnc: null });
    expect(repo.expiry.get('s1')!.getTime() - row.sentAt!.getTime()).toBe(48 * 3_600_000);
  });
});

describe('Resend failures', () => {
  it('gives the slot back and counts the attempt; the third failure marks the row failed', async () => {
    const { repo, mails, deps } = setup({ failResend: () => true });
    const r = await enqueueEmail(deps, 'confirm', 's1', 'a@example.com', 't1');
    expect(r.queued).toBe(true);
    expect(repo.days.get(repo.today)).toBe(0);
    expect(repo.rows[0]).toMatchObject({ status: 'queued', attempts: 1 });
    await drainOutbox(deps, 20);
    expect(repo.rows[0]).toMatchObject({ status: 'queued', attempts: 2 });
    await drainOutbox(deps, 20);
    expect(repo.rows[0]).toMatchObject({ status: 'failed', attempts: 3 });
    expect(repo.days.get(repo.today)).toBe(0);
    expect(await drainOutbox(deps, 20)).toEqual({ sent: 0, left: 0 });
    expect(mails).toHaveLength(0);
  });

  it('stops a drain after three failures in a row', async () => {
    const { repo, deps } = setup({ cap: 20, failResend: () => true });
    for (let i = 0; i < 6; i++) await repo.upsertQueued('confirm', `s${i}`, 'x', 'y');
    // Rows hold garbage payloads, so every send fails before reaching Resend.
    await drainOutbox(deps, 20);
    expect(repo.rows.filter((r) => r.attempts === 1)).toHaveLength(3);
    expect(repo.rows.filter((r) => r.attempts === 0)).toHaveLength(3);
  });
});

describe('templates', () => {
  it('holds the exact confirmation and removal text', () => {
    expect(renderEmail('confirm', `${SITE}/api/confirm?token=abc`, SITE)).toEqual({
      subject: 'Confirm your signature for Fair Maps',
      text: `Thanks for signing. Click to confirm, and you’ll be counted in your district:\n\n${SITE}/api/confirm?token=abc\n\nThis link works for 48 hours. If you didn’t sign, ignore this email and nothing happens.\n\nChanged your mind later? Remove yourself any time at ${SITE}/remove`,
    });
    expect(renderEmail('remove', `${SITE}/remove?token=abc`, SITE)).toEqual({
      subject: 'Remove your Fair Maps signature',
      text: `Someone asked to remove this email’s signature from Fair Maps. To remove it, open this link and press Remove me:\n\n${SITE}/remove?token=abc\n\nThe link works for 48 hours. If you didn’t ask, ignore this email and nothing changes.`,
    });
  });
  it('sends the confirm link built from the raw token', async () => {
    const { mails, deps } = setup();
    await enqueueEmail(deps, 'confirm', 's1', 'a@example.com', 'f'.repeat(64));
    expect(mails[0]!.text).toContain(`${SITE}/api/confirm?token=${'f'.repeat(64)}`);
  });
});

describe('GET /api/cron-drain', () => {
  const make = (secret: string | undefined) => {
    const s = setup();
    return { ...s, handler: cronDrainHandler({ cronSecret: () => secret, outbox: () => s.deps }) };
  };
  const req = (auth?: string) => new Request('https://site.test/api/cron-drain', { headers: auth ? { authorization: auth } : {} });

  it('answers 401 without the correct bearer token and does nothing', async () => {
    const { handler, repo } = make('s3cret');
    await repo.upsertQueued('confirm', 's1', 'x', 'y');
    for (const auth of [undefined, 'Bearer wrong', 's3cret', 'Bearer s3cret2']) expect((await handler(req(auth))).status).toBe(401);
    expect(repo.rows[0]!.attempts).toBe(0);
  });

  it('answers 401 when no secret is configured', async () => {
    expect((await make(undefined).handler(req('Bearer '))).status).toBe(401);
  });

  it('drains with the correct token', async () => {
    const { handler, repo, deps, mails } = make('s3cret');
    deps.config.emailDailyCap = 1;
    await enqueueEmail(deps, 'confirm', 's1', 'a@example.com', 't1');
    await enqueueEmail(deps, 'confirm', 's2', 'b@example.com', 't2');
    repo.today = '2026-10-28';
    const res = await handler(req('Bearer s3cret'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sent: 1, left: 0 });
    expect(mails).toHaveLength(2);
  });
});
