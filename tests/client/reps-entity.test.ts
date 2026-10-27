// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { RepSchema as ServerRep, StateRepsSchema as ServerState } from '../../src/server/features/reps';
import { RepSchema, StateRepsSchema, loadStateReps } from '../../src/client/entities/reps';
import { clearFetchCache } from '../../src/client/shared';

const co = JSON.parse(readFileSync('public/data/reps/CO.json', 'utf8')) as unknown;

describe('reps entity', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    clearFetchCache();
  });

  it('accepts and rejects what the server schema does', () => {
    expect(StateRepsSchema.safeParse(co).success).toBe(true);
    expect(ServerState.safeParse(co).success).toBe(true);
    const bad = [{}, { id: 'x', name: 'n', office: 'mayor' }, { id: '', name: 'n' }];
    for (const b of bad) expect(RepSchema.safeParse(b).success).toBe(ServerRep.safeParse(b).success);
  });

  it('loads a state once and validates it', async () => {
    const f = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(co)));
    vi.stubGlobal('fetch', f);
    const a = await loadStateReps('CO');
    await loadStateReps('CO');
    expect(a.state).toBe('CO');
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('rejects a file of the wrong shape', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ state: 'ZZ' }))));
    await expect(loadStateReps('ZZ')).rejects.toBeTruthy();
  });
});
