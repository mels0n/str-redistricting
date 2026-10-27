import { db } from './client.js';

export interface RemovalToken {
  id: string;
  /** Set when the removal email goes out; null while it waits. */
  expiresAt: string | null;
  /** When the token was made. */
  setAt: string | null;
}

/** The data access the removal flow uses. Tests pass an in-memory implementation. */
export interface RemovalRepo {
  /**
   * Stores the hash of a new removal token on the signer with this email hash (an older token stops working, and the 48 hours
   * start when the email is sent). Null when nobody has the hash, or when the signer's last token was made after `cooldownBeforeIso`
   * (nothing changes then).
   */
  setRemoveToken(emailHash: string, tokenHash: string, nowIso: string, cooldownBeforeIso: string): Promise<{ id: string } | null>;
  findByRemoveTokenHash(tokenHash: string): Promise<RemovalToken | null>;
  /** Deletes the signer (their notes and queued emails cascade). False when the row was already gone. */
  deleteSigner(id: string): Promise<boolean>;
}

const fail = (): never => {
  throw new Error('database error');
};

export function removalRepo(): RemovalRepo {
  return {
    async setRemoveToken(emailHash, tokenHash, nowIso, cooldownBeforeIso) {
      const { data, error } = await db()
        .from('signers')
        .update({ remove_token_hash: tokenHash, remove_token_expires_at: null, remove_token_set_at: nowIso })
        .eq('email_hash', emailHash)
        .or(`remove_token_set_at.is.null,remove_token_set_at.lt.${cooldownBeforeIso}`)
        .select('id');
      if (error) fail();
      return data && data.length > 0 ? { id: String(data[0]!.id) } : null;
    },
    async findByRemoveTokenHash(tokenHash) {
      const { data, error } = await db().from('signers').select('id, remove_token_expires_at, remove_token_set_at').eq('remove_token_hash', tokenHash).limit(1);
      if (error) fail();
      const r = data?.[0];
      return r ? { id: String(r.id), expiresAt: (r.remove_token_expires_at as string | null) ?? null, setAt: (r.remove_token_set_at as string | null) ?? null } : null;
    },
    async deleteSigner(id) {
      const { data, error } = await db().from('signers').delete().eq('id', id).select('id');
      if (error) fail();
      return (data?.length ?? 0) > 0;
    },
  };
}
