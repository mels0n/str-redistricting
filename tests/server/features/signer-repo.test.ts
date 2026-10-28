import { describe, expect, it, vi } from 'vitest';
import type { PendingSigner } from '../../../src/server/entities/signon-db/index.js';

const updates: Record<string, unknown>[] = [];

// A chain that records what `update` is given and answers like a refreshed pending row.
vi.mock('../../../src/server/entities/signon-db/client.js', () => {
  const chain = (): unknown =>
    new Proxy(() => undefined, {
      get: (_t, prop) => (prop === 'then' ? (ok: (v: unknown) => unknown) => ok({ data: [{ id: 'sig-1' }], error: null }) : (...args: unknown[]) => {
        if (prop === 'update') updates.push(args[0] as Record<string, unknown>);
        return chain();
      }),
    });
  return { db: () => ({ from: () => chain() }), ping: async () => undefined };
});

const { signerRepo } = await import('../../../src/server/entities/signon-db/signers.js');

describe('signerRepo.upsertPending', () => {
  it('resets created_at when it refreshes a pending signer, so cleanup measures age from the latest sign-up', async () => {
    const input = { emailHash: 'h', tokenHash: 't', state: 'CO' } as PendingSigner;
    const before = Date.now();
    expect(await signerRepo().upsertPending(input)).toEqual({ id: 'sig-1' });
    const refreshed = updates[0]!;
    expect(Date.parse(String(refreshed.created_at))).toBeGreaterThanOrEqual(before);
    expect(refreshed.token_expires_at).toBeNull();
    expect(refreshed.status).toBe('pending');
  });
});
