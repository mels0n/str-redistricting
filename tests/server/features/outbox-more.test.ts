import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmailKind, OutboxRepo, OutboxRow } from '../../../src/server/entities/signon-db/index.js';
import { drainOutbox, enqueueEmail, type OutboxDeps } from '../../../src/server/features/outbox/index.js';
import { open, seal } from '../../../src/server/shared/crypto/index.js';

const KEY = Buffer.alloc(32, 2);

interface Stored extends Omit<OutboxRow, 'toEnc' | 'tokenEnc'> {
  status: 'queued' | 'sent' | 'failed';
  toEnc: string | null;
  tokenEnc: string | null;
}

/** In-memory outbox with a day's quota and a removal share, like the real tables and functions. */
class Fake implements OutboxRepo {
  rows: Stored[] = [];
  sent = 0;
  removed = 0;
  deletedSigners: string[] = [];
  private nextId = 1;
  async upsertQueued(kind: EmailKind, signerId: string, toEnc: string, tokenEnc: string) {
    const waiting = this.rows.find((r) => r.signerId === signerId && r.kind === kind && r.status === 'queued');
    if (waiting) {
      Object.assign(waiting, { toEnc, tokenEnc, attempts: 0 });
      return { ...waiting } as OutboxRow;
    }
    const row: Stored = { id: this.nextId++, kind, signerId, toEnc, tokenEnc, attempts: 0, status: 'queued' };
    this.rows.push(row);
    return { ...row } as OutboxRow;
  }
  async hasQueuedAhead(row: OutboxRow) {
    return this.rows.some((r) => r.status === 'queued' && r.id !== row.id && (row.kind === 'remove' ? r.kind === 'remove' && r.id < row.id : r.kind === 'remove' || r.id < row.id));
  }
  async listQueued(limit: number, kind?: EmailKind) {
    return this.rows.filter((r) => r.status === 'queued' && (!kind || r.kind === kind)).slice(0, limit).map((r) => ({ ...r }) as OutboxRow);
  }
  async countQueued() {
    return this.rows.filter((r) => r.status === 'queued').length;
  }
  async getQueued(id: number) {
    const r = this.rows.find((x) => x.id === id && x.status === 'queued');
    return r ? ({ ...r } as OutboxRow) : null;
  }
  async quotaSpent(cap: number) {
    return this.sent >= cap;
  }
  async claimSlot(cap: number, kind?: EmailKind) {
    if (this.sent >= cap) return false;
    if (kind === 'remove') {
      if (this.removed >= Math.max(1, Math.floor(cap / 2))) return false;
      this.removed++;
    }
    this.sent++;
    return true;
  }
  async releaseSlot(kind?: EmailKind) {
    if (kind === 'remove') this.removed--;
    this.sent--;
  }
  async markSent(row: OutboxRow) {
    const r = this.rows.find((x) => x.id === row.id && x.status === 'queued' && x.tokenEnc === row.tokenEnc);
    if (r) Object.assign(r, { status: 'sent', toEnc: null, tokenEnc: null });
  }
  async recordFailure(row: OutboxRow, max: number) {
    const r = this.rows.find((x) => x.id === row.id && x.status === 'queued' && x.tokenEnc === row.tokenEnc);
    if (!r) return;
    r.attempts = row.attempts + 1;
    if (r.attempts >= max) Object.assign(r, { status: 'failed', toEnc: null, tokenEnc: null });
  }
  async deletePendingSigner(signerId: string) {
    this.deletedSigners.push(signerId);
    this.rows = this.rows.filter((r) => r.signerId !== signerId);
  }
}

function setup(opts: { cap?: number; status?: number; fail?: boolean; after?: (t: Promise<unknown>) => void } = {}) {
  const repo = new Fake();
  const mails: string[] = [];
  const deps: OutboxDeps = {
    repo,
    config: { resendApiKey: 'rk', from: 'Fair Maps <a@b.test>', siteOrigin: 'https://site.test', encryptionKey: KEY, emailDailyCap: opts.cap ?? 20 },
    fetchFn: (async (_u: unknown, init: RequestInit) => {
      if (opts.fail) return new Response('{}', { status: opts.status ?? 500 });
      mails.push((JSON.parse(String(init.body)) as { to: string[] }).to[0]!);
      return Response.json({ id: 'x' });
    }) as typeof fetch,
    after: opts.after,
  };
  return { repo, mails, deps };
}

const queue = (repo: Fake, kind: EmailKind, signer: string, token = 't') => repo.upsertQueued(kind, signer, seal(`${signer}@example.com`, KEY), seal(token, KEY));
const logs = () => vi.mocked(console.error).mock.calls.map((c) => String(c[0]));

beforeEach(() => void vi.spyOn(console, 'error').mockImplementation(() => {}));
afterEach(() => vi.restoreAllMocks());

describe('safe marking and per-kind lists', () => {
  it('leaves a row queued when it was replaced between the read and the mark', async () => {
    const { repo, mails, deps } = setup({ cap: 5 });
    await queue(repo, 'confirm', 's1', 'old');
    const getQueued = repo.getQueued.bind(repo);
    repo.getQueued = async (id: number) => {
      const row = await getQueued(id);
      // The signer signs again while the mail is on its way: same row, new sealed token.
      await queue(repo, 'confirm', 's1', 'new');
      return row;
    };
    expect(await drainOutbox(deps, 5)).toMatchObject({ sent: 1, left: 1 });
    expect(mails).toHaveLength(1);
    expect(repo.rows[0]).toMatchObject({ status: 'queued' });
    expect(open(repo.rows[0]!.tokenEnc!, KEY)).toBe('new');
  });

  it('does not count a failure against a row that was replaced', async () => {
    const { repo, deps } = setup({ cap: 5, fail: true });
    await queue(repo, 'confirm', 's1', 'old');
    const getQueued = repo.getQueued.bind(repo);
    repo.getQueued = async (id: number) => {
      const row = await getQueued(id);
      await queue(repo, 'confirm', 's1', 'new');
      return row;
    };
    await drainOutbox(deps, 5);
    expect(repo.rows[0]).toMatchObject({ status: 'queued', attempts: 0 });
  });

  it('still sends a confirmation when more removals than one page are waiting', async () => {
    const { repo, mails, deps } = setup({ cap: 10 });
    for (let i = 0; i < 501; i++) await queue(repo, 'remove', `r${i}`);
    await queue(repo, 'confirm', 'c1');
    const result = await drainOutbox(deps, 10);
    expect(result.sent).toBe(6);
    expect(mails).toContain('c1@example.com');
  });

  it('lets a removal go out when the cap is 1', async () => {
    const { repo, mails, deps } = setup({ cap: 1 });
    await queue(repo, 'remove', 'r1');
    expect(await drainOutbox(deps, 1)).toEqual({ sent: 1, failed: 0, left: 0 });
    expect(mails).toHaveLength(1);
  });
});

describe('failed and refused sends', () => {
  it('deletes the signer at once when the provider refuses a confirmation address, and logs the row id only', async () => {
    const { repo, deps } = setup({ fail: true, status: 422 });
    const r = await enqueueEmail(deps, 'confirm', 's1', 'bad@example.com', 'secret-token');
    expect(r.queued).toBe(true);
    expect(repo.deletedSigners).toEqual(['s1']);
    expect(repo.rows).toHaveLength(0);
    expect(repo.sent).toBe(0);
    expect(JSON.parse(logs()[0]!)).toEqual({ event: 'email-send-failed', rowId: 1, kind: 'confirm', status: 422, attempt: 1, final: true });
    expect(logs().join('\n')).not.toContain('bad@example.com');
    expect(logs().join('\n')).not.toContain('secret-token');
  });

  it('marks a refused removal row failed and deletes nothing', async () => {
    const { repo, deps } = setup({ fail: true, status: 400 });
    await enqueueEmail(deps, 'remove', 's1', 'bad@example.com', 't');
    expect(repo.deletedSigners).toEqual([]);
    expect(repo.rows[0]).toMatchObject({ status: 'failed', toEnc: null, tokenEnc: null });
  });

  it.each([401, 403, 429, 500])('keeps retrying on %i and does not delete anyone', async (status) => {
    const { repo, deps } = setup({ fail: true, status });
    await enqueueEmail(deps, 'confirm', 's1', 'a@example.com', 't');
    expect(repo.deletedSigners).toEqual([]);
    expect(repo.rows[0]).toMatchObject({ status: 'queued', attempts: 1 });
    expect(logs().some((l) => l.includes('email-send-auth-rejected'))).toBe(status === 401 || status === 403);
  });

  it('logs network and unseal failures by cause', async () => {
    const { repo, deps } = setup();
    deps.fetchFn = (async () => { throw new Error('offline'); }) as typeof fetch;
    await enqueueEmail(deps, 'confirm', 's1', 'a@example.com', 't');
    await repo.upsertQueued('confirm', 's2', 'not-sealed', 'not-sealed');
    await drainOutbox(deps, 20);
    const statuses = logs().filter((l) => l.includes('email-send-failed')).map((l) => JSON.parse(l).status);
    expect(statuses).toEqual(expect.arrayContaining(['network', 'unseal']));
  });

  it('reports failed sends from the drain without stopping on refused addresses', async () => {
    const { repo, deps } = setup({ cap: 20, fail: true, status: 422 });
    for (let i = 0; i < 5; i++) await queue(repo, 'confirm', `s${i}`);
    expect(await drainOutbox(deps, 20)).toEqual({ sent: 0, failed: 5, left: 0 });
    expect(repo.deletedSigners).toHaveLength(5);
  });
});

describe('deferred sending', () => {
  it('takes the slot and writes the row before returning, and sends in the after hook', async () => {
    const tasks: Promise<unknown>[] = [];
    const { repo, mails, deps } = setup({ after: (t) => void tasks.push(t) });
    expect(await enqueueEmail(deps, 'confirm', 's1', 'a@example.com', 't1')).toEqual({ queued: false });
    expect(repo.rows).toHaveLength(1);
    expect(repo.sent).toBe(1);
    expect(tasks).toHaveLength(1);
    await Promise.all(tasks);
    expect(mails).toHaveLength(1);
    expect(repo.rows[0]).toMatchObject({ status: 'sent' });
  });

  it('leaves the row queued for the daily job when the deferred send fails', async () => {
    const tasks: Promise<unknown>[] = [];
    const { repo, deps } = setup({ fail: true, after: (t) => void tasks.push(t) });
    expect(await enqueueEmail(deps, 'confirm', 's1', 'a@example.com', 't1')).toEqual({ queued: false });
    await Promise.all(tasks);
    expect(repo.rows[0]).toMatchObject({ status: 'queued', attempts: 1 });
    expect(repo.sent).toBe(0);
  });

  it('does not defer when the email must wait in line', async () => {
    const tasks: Promise<unknown>[] = [];
    const { deps } = setup({ cap: 0, after: (t) => void tasks.push(t) });
    expect(await enqueueEmail(deps, 'confirm', 's1', 'a@example.com', 't1')).toEqual({ queued: true });
    expect(tasks).toHaveLength(0);
  });
});
