import { describe, expect, it, vi } from 'vitest';

const calls: { op: string; args: unknown[] }[] = [];
vi.mock('../../../src/server/entities/signon-db/client.js', () => {
  const chain = (): unknown =>
    new Proxy(() => undefined, {
      get: (_t, prop) => (prop === 'then' ? (ok: (v: unknown) => unknown) => ok({ data: [], error: null }) : (...args: unknown[]) => {
        calls.push({ op: String(prop), args });
        return chain();
      }),
    });
  return { db: () => ({ from: () => chain() }), ping: async () => undefined };
});

const { notesRepo } = await import('../../../src/server/entities/signon-db/notes.js');

describe('notesRepo.insertNote', () => {
  it('is one upsert keyed on the signer, back to pending, with no delete', async () => {
    calls.length = 0;
    await notesRepo().insertNote({ signerId: 's1', bodyEnc: 'v1:x', showPublic: true, shareWithRep: false, flags: [] });
    expect(calls.map((c) => c.op)).toEqual(['upsert']);
    expect(calls[0]!.args[0]).toMatchObject({ signer_id: 's1', status: 'pending', reviewed_at: null });
    expect(calls[0]!.args[1]).toEqual({ onConflict: 'signer_id' });
  });
});
