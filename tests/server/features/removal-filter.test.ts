import { describe, expect, it, vi } from 'vitest';

const filters: string[] = [];

vi.mock('../../../src/server/entities/signon-db/client.js', () => {
  const chain = (): unknown =>
    new Proxy(() => undefined, {
      get: (_t, prop) => (prop === 'then' ? (ok: (v: unknown) => unknown) => ok({ data: [], error: null }) : (...args: unknown[]) => {
        if (prop === 'or') filters.push(String(args[0]));
        return chain();
      }),
    });
  return { db: () => ({ from: () => chain() }), ping: async () => undefined };
});

const { removalRepo } = await import('../../../src/server/entities/signon-db/removal.js');

describe('removalRepo.setRemoveToken', () => {
  it('uses one filter that refuses a new token while a sent link is valid and within the cooldown', async () => {
    await removalRepo().setRemoveToken('h', 't', '2026-11-01T12:00:00.000Z', '2026-11-01T11:30:00.000Z');
    expect(filters).toEqual([
      'remove_token_set_at.is.null,and(remove_token_set_at.lt.2026-11-01T11:30:00.000Z,or(remove_token_expires_at.is.null,remove_token_expires_at.lt.2026-11-01T12:00:00.000Z))',
    ]);
  });
});
