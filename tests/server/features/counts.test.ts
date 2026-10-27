import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AskRow, CountsRepo, DistrictRow, SignerRepo } from '../../../src/server/entities/signon-db/index.js';
import { askHandler } from '../../../src/server/api/ask.js';
import { countsHandler } from '../../../src/server/api/counts.js';

const NOW = new Date('2026-10-27T15:00:00Z');

/** In-memory stand-in: only confirmed signers feed the district rows, as the view does. */
class FakeCounts implements CountsRepo {
  signers: { state: string; usHouse: string | null; stateHouse: string | null; stateSenate: string | null; status: 'pending' | 'confirmed' }[] = [];
  asks: { key: string; office: string }[] = [];
  queued = 0;
  async districtRows(state: string): Promise<DistrictRow[]> {
    const m = new Map<string, DistrictRow>();
    for (const s of this.signers.filter((x) => x.state === state && x.status === 'confirmed')) {
      const k = [s.usHouse, s.stateHouse, s.stateSenate].join('|');
      const row = m.get(k) ?? { state, usHouse: s.usHouse, stateHouse: s.stateHouse, stateSenate: s.stateSenate, signers: 0 };
      row.signers++;
      m.set(k, row);
    }
    return [...m.values()];
  }
  async nationalTotal() {
    return this.signers.filter((s) => s.status === 'confirmed').length;
  }
  async waiting() {
    return this.queued;
  }
  async askRows(state: string): Promise<AskRow[]> {
    const m = new Map<string, number>();
    for (const a of this.asks.filter((x) => x.key.startsWith(`${state}:`))) m.set(a.key, (m.get(a.key) ?? 0) + 1);
    return [...m].map(([districtKey, asks]) => ({ districtKey, asks }));
  }
  async recordAsk(key: string, office: string) {
    this.asks.push({ key, office });
  }
}

const s = (state: string, usHouse: string | null, stateHouse: string | null, stateSenate: string | null, status: 'pending' | 'confirmed' = 'confirmed') => ({ state, usHouse, stateHouse, stateSenate, status });

beforeEach(() => void vi.spyOn(console, 'error').mockImplementation(() => {}));
afterEach(() => vi.restoreAllMocks());

describe('GET /api/counts', () => {
  const setup = () => {
    const repo = new FakeCounts();
    repo.signers = [s('CO', '03', '004', '012'), s('CO', '03', '005', '012'), s('CO', '01', '004', '010'), s('CO', '03', '004', '012', 'pending'), s('UT', '01', null, null)];
    repo.asks = [{ key: 'CO:us-house:03', office: 'us-house' }, { key: 'CO:us-house:03', office: 'us-house' }, { key: 'UT:us-house:01', office: 'us-house' }];
    repo.queued = 2;
    return { repo, handler: countsHandler({ repo: () => repo }) };
  };
  const get = (q = '') => new Request(`https://site.test/api/counts${q}`);

  it('sums confirmed rows only, per district and per state, with ask counts and the waiting number', async () => {
    const { handler } = setup();
    const res = await handler(get('?state=CO'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      national: 4,
      state: 3,
      waiting: 2,
      byKey: {
        'CO:us-house:03': 2,
        'CO:us-house:01': 1,
        'CO:state-house:004': 2,
        'CO:state-house:005': 1,
        'CO:state-senate:012': 2,
        'CO:state-senate:010': 1,
        'CO:us-senate:state': 3,
        'CO:us-house:03#asks': 2,
      },
    });
  });

  it('sends the cache header, and without a state only the national total and waiting', async () => {
    const { handler } = setup();
    const res = await handler(get());
    expect(res.headers.get('cache-control')).toBe('public, s-maxage=60, stale-while-revalidate=300');
    expect(await res.json()).toEqual({ national: 4, waiting: 2 });
  });

  it('rejects a bad state and unknown parameters', async () => {
    const { handler } = setup();
    expect((await handler(get('?state=co'))).status).toBe(400);
    expect((await handler(get('?state=CO&x=1'))).status).toBe(400);
  });

  it('answers 503 when the database fails', async () => {
    const { repo, handler } = setup();
    repo.nationalTotal = async () => {
      throw new Error('db down');
    };
    const res = await handler(get('?state=CO'));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'unavailable' });
  });
});

describe('POST /api/ask', () => {
  const setup = (vercelEnv: string | undefined = 'production') => {
    const counts = new FakeCounts();
    const attempts: string[] = [];
    const rate = {
      async recordAttempt(ip: string) {
        attempts.push(ip);
      },
      async countAttempts(ip: string) {
        return attempts.filter((a) => a === ip).length;
      },
    } as unknown as SignerRepo;
    const handler = askHandler({ loadConfig: () => ({ vercelEnv, hashSecret: Buffer.alloc(32, 1) }), rateRepo: () => rate, repo: () => counts, now: () => NOW });
    return { counts, attempts, handler };
  };
  const post = (body: unknown, ip = '9.9.9.9') => new Request('https://site.test/api/ask', { method: 'POST', body: JSON.stringify(body), headers: { 'x-forwarded-for': ip } });
  const ASK = { key: 'CO:state-house:004', office: 'state-house' };

  it('stores one row and answers 204', async () => {
    const { handler, counts } = setup();
    const res = await handler(post(ASK));
    expect(res.status).toBe(204);
    expect(counts.asks).toEqual([ASK]);
  });

  it('answers 503 outside production and stores nothing', async () => {
    const { handler, counts } = setup('preview');
    expect((await handler(post(ASK))).status).toBe(503);
    expect(counts.asks).toEqual([]);
  });

  it('rejects malformed keys, a key whose office disagrees, and extra fields', async () => {
    const { handler, counts } = setup();
    for (const bad of [{ key: 'co:state-house:004', office: 'state-house' }, { key: 'CO:mayor:1', office: 'state-house' }, { key: 'CO:us-house:03', office: 'state-house' }, { ...ASK, extra: 1 }, {}]) {
      expect((await handler(post(bad))).status).toBe(400);
    }
    expect(counts.asks).toEqual([]);
  });

  it('refuses the 6th request from one address in an hour, and keeps the address out of storage', async () => {
    const { handler, counts, attempts } = setup();
    for (let i = 0; i < 5; i++) expect((await handler(post(ASK))).status).toBe(204);
    expect((await handler(post(ASK))).status).toBe(429);
    expect(counts.asks).toHaveLength(5);
    expect(attempts.join()).not.toContain('9.9.9.9');
  });
});
