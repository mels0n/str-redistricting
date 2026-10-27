import { describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = { signers: [], email_outbox: [], rate_limits: [] };

/** A small in-memory query builder covering just the calls the cleanup makes. */
function query(table: string): unknown {
  let mode: 'select' | 'delete' = 'select';
  const filters: ((r: Row) => boolean)[] = [];
  let max = Infinity;
  const run = () => {
    const hit = tables[table]!.filter((r) => filters.every((f) => f(r)));
    if (mode === 'delete') {
      tables[table] = tables[table]!.filter((r) => !hit.includes(r));
      return { data: null, error: null };
    }
    return { data: hit.slice(0, max), error: null };
  };
  const api: Record<string, unknown> = {
    select: () => api,
    delete: () => ((mode = 'delete'), api),
    eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), api),
    lt: (c: string, v: string) => (filters.push((r) => r[c] != null && String(r[c]) < v), api),
    not: (c: string, _op: string, v: unknown) => (filters.push((r) => r[c] !== v), api),
    in: (c: string, v: unknown[]) => (filters.push((r) => v.includes(r[c])), api),
    limit: (n: number) => ((max = n), api),
    then: (ok: (v: unknown) => unknown) => ok(run()),
  };
  return api;
}

vi.mock('../../../src/server/entities/signon-db/client.js', () => ({ db: () => ({ from: (t: string) => query(t) }), ping: async () => undefined }));

const { signerRepo } = await import('../../../src/server/entities/signon-db/signers.js');

const NOW = Date.parse('2026-11-01T12:00:00Z');
const ago = (days: number) => new Date(NOW - days * 86_400_000).toISOString();

describe('signerRepo.cleanup', () => {
  it('deletes only pending signers whose sent link expired over a week ago and who have no queued email', async () => {
    tables.signers = [
      { id: 'old-never-sent', status: 'pending', created_at: ago(90), token_expires_at: null },
      { id: 'old-queued', status: 'pending', created_at: ago(90), token_expires_at: null },
      { id: 'sent-long-expired', status: 'pending', created_at: ago(40), token_expires_at: ago(10) },
      { id: 'sent-recently-expired', status: 'pending', created_at: ago(40), token_expires_at: ago(3) },
      { id: 'expired-but-requeued', status: 'pending', created_at: ago(40), token_expires_at: ago(10) },
      { id: 'confirmed', status: 'confirmed', created_at: ago(90), token_expires_at: ago(30) },
    ];
    tables.email_outbox = [
      { id: 1, signer_id: 'old-queued', status: 'queued' },
      { id: 2, signer_id: 'expired-but-requeued', status: 'queued' },
      { id: 3, signer_id: 'sent-long-expired', status: 'sent' },
    ];
    tables.rate_limits = [{ at: ago(2) }, { at: ago(0) }];

    await signerRepo().cleanup(ago(1), ago(7));

    expect(tables.signers.map((r) => r.id).sort()).toEqual(['confirmed', 'expired-but-requeued', 'old-never-sent', 'old-queued', 'sent-recently-expired']);
    expect(tables.rate_limits).toHaveLength(1);
  });
});
