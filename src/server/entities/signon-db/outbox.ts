import { db } from './client.js';

export type EmailKind = 'confirm' | 'remove';

export interface OutboxRow {
  id: number;
  kind: EmailKind;
  signerId: string;
  /** Sealed address and token; both are gone once the email is sent. */
  toEnc: string;
  tokenEnc: string;
  attempts: number;
}

/** The data access the outbox uses. Tests pass an in-memory implementation. */
export interface OutboxRepo {
  /** Queues a row, or replaces the sealed payload of the signer's waiting row of this kind (it keeps its place in line). */
  upsertQueued(kind: EmailKind, signerId: string, toEnc: string, tokenEnc: string): Promise<OutboxRow>;
  /** True when a queued row would be sent before this one: any waiting removal, then waiting rows with a lower id of the same kind. */
  hasQueuedAhead(row: OutboxRow): Promise<boolean>;
  /** Waiting rows in sending order: removals first, then oldest first. */
  listQueued(limit: number): Promise<OutboxRow[]>;
  countQueued(): Promise<number>;
  /** Atomically takes one of today's slots (`claim_email_slot`). */
  claimSlot(cap: number): Promise<boolean>;
  releaseSlot(): Promise<void>;
  /** Marks the row sent, drops its sealed payload and starts the signer's 48 hours (`mark_email_sent`). */
  markSent(id: number): Promise<void>;
  /** Adds one attempt; the row becomes `failed` once it reaches `maxAttempts`. */
  recordFailure(row: OutboxRow, maxAttempts: number): Promise<void>;
}

const fail = (): never => {
  throw new Error('database error');
};

interface DbRow {
  id: number;
  kind: EmailKind;
  signer_id: string;
  to_enc: string;
  token_enc: string;
  attempts: number;
}

const toRow = (r: DbRow): OutboxRow => ({ id: Number(r.id), kind: r.kind, signerId: r.signer_id, toEnc: r.to_enc, tokenEnc: r.token_enc, attempts: r.attempts });
const COLUMNS = 'id, kind, signer_id, to_enc, token_enc, attempts';

export function outboxRepo(): OutboxRepo {
  return {
    async upsertQueued(kind, signerId, toEnc, tokenEnc) {
      const existing = await db().from('email_outbox').update({ to_enc: toEnc, token_enc: tokenEnc, attempts: 0 }).eq('signer_id', signerId).eq('kind', kind).eq('status', 'queued').select(COLUMNS);
      if (existing.error) fail();
      if (existing.data && existing.data.length > 0) return toRow(existing.data[0] as DbRow);
      const ins = await db().from('email_outbox').insert({ kind, signer_id: signerId, to_enc: toEnc, token_enc: tokenEnc, status: 'queued' }).select(COLUMNS);
      if (ins.error || !ins.data?.[0]) {
        // A concurrent sign-up queued the same signer first: take its row.
        const again = await db().from('email_outbox').update({ to_enc: toEnc, token_enc: tokenEnc }).eq('signer_id', signerId).eq('kind', kind).eq('status', 'queued').select(COLUMNS);
        if (again.error || !again.data?.[0]) return fail();
        return toRow(again.data[0] as DbRow);
      }
      return toRow(ins.data[0] as DbRow);
    },
    async hasQueuedAhead(row) {
      const q = db().from('email_outbox').select('id', { count: 'exact', head: true }).eq('status', 'queued');
      const { count, error } = await (row.kind === 'remove' ? q.eq('kind', 'remove').lt('id', row.id) : q.or(`kind.eq.remove,id.lt.${row.id}`));
      if (error) fail();
      return (count ?? 0) > 0;
    },
    async listQueued(limit) {
      // 'remove' sorts after 'confirm', so descending puts removals first.
      const { data, error } = await db().from('email_outbox').select(COLUMNS).eq('status', 'queued').order('kind', { ascending: false }).order('created_at').order('id').limit(limit);
      if (error) fail();
      return (data as DbRow[]).map(toRow);
    },
    async countQueued() {
      const { count, error } = await db().from('email_outbox').select('id', { count: 'exact', head: true }).eq('status', 'queued');
      if (error) fail();
      return count ?? 0;
    },
    async claimSlot(cap) {
      const { data, error } = await db().rpc('claim_email_slot', { cap });
      if (error) fail();
      return data === true;
    },
    async releaseSlot() {
      const { error } = await db().rpc('release_email_slot');
      if (error) fail();
    },
    async markSent(id) {
      const { error } = await db().rpc('mark_email_sent', { p_id: id });
      if (error) fail();
    },
    async recordFailure(row, maxAttempts) {
      const attempts = row.attempts + 1;
      const { error } = await db().from('email_outbox').update({ attempts, status: attempts >= maxAttempts ? 'failed' : 'queued' }).eq('id', row.id);
      if (error) fail();
    },
  };
}
