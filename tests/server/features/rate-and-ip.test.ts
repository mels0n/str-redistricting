import { describe, expect, it, vi } from 'vitest';
import { askHandler } from '../../../src/server/api/ask.js';
import type { SignerRepo } from '../../../src/server/entities/signon-db/index.js';
import { checkRateLimit, ipKey } from '../../../src/server/features/signon/index.js';
import { SignonError } from '../../../src/server/shared/errors/signon.js';

const NOW = new Date('2026-11-01T12:00:00Z');

function repo(initial = 0) {
  const state = { count: initial, records: 0, counts: 0 };
  return {
    state,
    repo: {
      async countAttempts() { state.counts++; return state.count; },
      async recordAttempt() { state.records++; state.count++; },
    } as unknown as SignerRepo,
  };
}

describe('checkRateLimit', () => {
  it('refuses at the limit without recording', async () => {
    const r = repo(5);
    await expect(checkRateLimit(r.repo, 'h', NOW)).rejects.toMatchObject({ code: 'rate-limit' });
    expect(r.state.records).toBe(0);
  });
  it('records then counts again when under the limit', async () => {
    const r = repo(4);
    await checkRateLimit(r.repo, 'h', NOW);
    expect(r.state).toMatchObject({ records: 1, counts: 2 });
  });
  it('refuses a parallel request that passed the first count but lost the race', async () => {
    let n = 0;
    const racing = {
      async countAttempts() { return n++ === 0 ? 4 : 6; },
      async recordAttempt() {},
    } as unknown as SignerRepo;
    await expect(checkRateLimit(racing, 'h', NOW)).rejects.toBeInstanceOf(SignonError);
  });
});

describe('ask body check', () => {
  it('refuses a malformed body before it touches the limiter', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = repo();
    const handler = askHandler({
      loadConfig: () => ({ vercelEnv: 'production', hashSecret: Buffer.alloc(32, 1) }),
      rateRepo: () => r.repo,
      repo: () => ({}) as never,
      now: () => NOW,
    });
    const res = await handler(new Request('https://x.test/api/ask', { method: 'POST', body: JSON.stringify({ nope: 1 }) }));
    expect(res.status).toBe(400);
    expect(r.state.counts + r.state.records).toBe(0);
  });
});

describe('ipKey', () => {
  it.each([
    ['203.0.113.7', '203.0.113.7'],
    ['::ffff:203.0.113.7', '203.0.113.7'],
    ['2001:db8:1:2:aaaa:bbbb:cccc:dddd', '2001:0db8:0001:0002::/64'],
    ['2001:db8:1:2::1', '2001:0db8:0001:0002::/64'],
    ['2001:DB8::5', '2001:0db8:0000:0000::/64'],
    ['::1', '0000:0000:0000:0000::/64'],
    ['unknown', 'unknown'],
    ['not:an:ip', 'not:an:ip'],
  ])('%s', (ip, key) => {
    expect(ipKey(ip)).toBe(key);
  });
  it('puts every address in a /64 under one key', () => {
    expect(ipKey('2001:db8:1:2:1:2:3:4')).toBe(ipKey('2001:db8:1:2:ffff:ffff:ffff:ffff'));
    expect(ipKey('2001:db8:1:3::1')).not.toBe(ipKey('2001:db8:1:2::1'));
  });
});
