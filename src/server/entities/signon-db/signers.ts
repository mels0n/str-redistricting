import { randomBytes } from 'node:crypto';
import { db } from './client.js';

/** What the sign flow stores for a signer waiting to confirm. The street address is never part of it. */
export interface PendingSigner {
  emailHash: string;
  emailEnc: string | null;
  consentUpdates: boolean;
  state: string;
  usHouse: string | null;
  stateHouse: string | null;
  stateSenate: string | null;
  displayNameEnc: string | null;
  townEnc: string | null;
  showPublic: boolean;
  tokenHash: string;
  refCode: string | null;
}

export interface TokenRow {
  id: string;
  state: string;
  status: 'pending' | 'confirmed';
  tokenExpiresAt: string | null;
}

/** The data access the sign and confirm flows use. Tests pass an in-memory implementation. */
export interface SignerRepo {
  /** Rows for this hashed address since `sinceIso`. */
  countAttempts(ipHash: string, sinceIso: string): Promise<number>;
  recordAttempt(ipHash: string): Promise<void>;
  /** True when a confirmed signer has this email hash. */
  isConfirmed(emailHash: string): Promise<boolean>;
  /** Inserts a pending signer, or refreshes the pending one with the same email hash. Null when a confirmed signer holds the hash. */
  upsertPending(input: PendingSigner): Promise<{ id: string } | null>;
  findByTokenHash(tokenHash: string): Promise<TokenRow | null>;
  confirm(id: string, confirmedAtIso: string): Promise<void>;
  /**
   * Deletes rate-limit rows before `rateBeforeIso`, and pending signers whose confirmation link went out and expired
   * before `expiredBeforeIso` and who have no email waiting in the queue. A pending signer whose link never went out
   * (no expiry set) is kept however old.
   */
  cleanup(rateBeforeIso: string, expiredBeforeIso: string): Promise<void>;
}

/** Signers looked at per cleanup run, so the id lists stay short; the next run takes the rest. */
const CLEANUP_BATCH = 100;

export const OWN_CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const CODE_ALPHABET = OWN_CODE_ALPHABET;
const newOwnCode = (): string => Array.from(randomBytes(8), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');

const fail = (): never => {
  throw new Error('database error');
};

export function signerRepo(): SignerRepo {
  return {
    async countAttempts(ipHash, sinceIso) {
      const { count, error } = await db().from('rate_limits').select('*', { count: 'exact', head: true }).eq('ip_hash', ipHash).gte('at', sinceIso);
      if (error) fail();
      return count ?? 0;
    },
    async recordAttempt(ipHash) {
      const { error } = await db().from('rate_limits').insert({ ip_hash: ipHash });
      if (error) fail();
    },
    async isConfirmed(emailHash) {
      const { data, error } = await db().from('signers').select('id').eq('email_hash', emailHash).eq('status', 'confirmed').limit(1);
      if (error) fail();
      return (data?.length ?? 0) > 0;
    },
    async upsertPending(input) {
      const fields = {
        email_enc: input.emailEnc,
        consent_updates: input.consentUpdates,
        state: input.state,
        us_house: input.usHouse,
        state_house: input.stateHouse,
        state_senate: input.stateSenate,
        display_name_enc: input.displayNameEnc,
        town_enc: input.townEnc,
        show_public: input.showPublic,
        status: 'pending' as const,
        token_hash: input.tokenHash,
        token_expires_at: null,
      };
      // Signing again refreshes a pending signer, so cleanup measures its age from now.
      const updated = await db().from('signers').update({ ...fields, created_at: new Date().toISOString() }).eq('email_hash', input.emailHash).eq('status', 'pending').select('id');
      if (updated.error) fail();
      if (updated.data && updated.data.length > 0) return { id: String(updated.data[0]!.id) };
      for (let attempt = 0; attempt < 3; attempt++) {
        const ins = await db().from('signers').insert({ ...fields, email_hash: input.emailHash, own_code: newOwnCode(), ref_code: input.refCode }).select('id');
        if (!ins.error) return { id: String(ins.data![0]!.id) };
        if (ins.error.code !== '23505') fail();
        // A duplicate email hash means a signer (confirmed, or pending that raced us) holds it; a duplicate own_code gets a new code.
        if (ins.error.message.includes('email_hash')) return null;
      }
      return fail();
    },
    async findByTokenHash(tokenHash) {
      const { data, error } = await db().from('signers').select('id, state, status, token_expires_at').eq('token_hash', tokenHash).limit(1);
      if (error) fail();
      const r = data?.[0];
      if (!r) return null;
      return { id: String(r.id), state: String(r.state), status: r.status as 'pending' | 'confirmed', tokenExpiresAt: (r.token_expires_at as string | null) ?? null };
    },
    async confirm(id, confirmedAtIso) {
      const { error } = await db().from('signers').update({ status: 'confirmed', confirmed_at: confirmedAtIso, token_expires_at: null }).eq('id', id);
      if (error) fail();
    },
    async cleanup(rateBeforeIso, expiredBeforeIso) {
      const a = await db().from('rate_limits').delete().lt('at', rateBeforeIso);
      if (a.error) fail();
      // Only a link that was sent has an expiry. A signer with a queued email is never deleted, whatever its expiry.
      const old = await db().from('signers').select('id').eq('status', 'pending').not('token_expires_at', 'is', null).lt('token_expires_at', expiredBeforeIso).limit(CLEANUP_BATCH);
      if (old.error) fail();
      const ids = (old.data ?? []).map((r) => String(r.id));
      if (ids.length === 0) return;
      const queued = await db().from('email_outbox').select('signer_id').eq('status', 'queued').in('signer_id', ids);
      if (queued.error) fail();
      const keep = new Set((queued.data ?? []).map((r) => String(r.signer_id)));
      const drop = ids.filter((id) => !keep.has(id));
      if (drop.length === 0) return;
      // Deleting a signer cascades to its (sent or failed) outbox rows.
      const b = await db().from('signers').delete().eq('status', 'pending').in('id', drop);
      if (b.error) fail();
    },
  };
}
