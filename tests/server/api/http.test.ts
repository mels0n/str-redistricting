import { afterEach, describe, expect, it, vi } from 'vitest';
import { handle } from '../../../src/server/api/http.js';
import { SignonError, type SignonErrorCode } from '../../../src/server/shared/errors/signon.js';

afterEach(() => vi.restoreAllMocks());

const CASES: [SignonErrorCode, number][] = [
  ['bad-request', 400],
  ['bot-check', 403],
  ['rate-limit', 429],
  ['address-not-found', 422],
  ['outside-states', 422],
  ['token-invalid', 400],
  ['token-expired', 410],
  ['unavailable', 503],
];

describe('handle', () => {
  it.each(CASES)('maps %s to %i', async (code, status) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await handle(async () => { throw new SignonError(code); })(new Request('https://x.test/a'));
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error: code });
    expect(res.headers.get('x-request-id')).toBeTruthy();
  });

  it('keeps an incoming request id and passes it to the handler', async () => {
    let seen = '';
    const res = await handle(async (_req, ctx) => { seen = ctx.requestId; return Response.json({ ok: true }); })(
      new Request('https://x.test/a', { headers: { 'x-request-id': 'abc-123' } }),
    );
    expect(seen).toBe('abc-123');
    expect(res.headers.get('x-request-id')).toBe('abc-123');
  });

  it('generates a request id when none is sent', async () => {
    const res = await handle(async () => Response.json({}))(new Request('https://x.test/a'));
    expect(res.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('answers an unknown error with 503 unavailable and logs only the id and code', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await handle(async () => { throw new Error('secret body content'); })(
      new Request('https://x.test/a', { method: 'POST', body: 'secret body content', headers: { 'x-request-id': 'r1' } }),
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'unavailable' });
    const logged = log.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(JSON.parse(logged)).toEqual({ requestId: 'r1', code: 'unavailable' });
    expect(logged).not.toContain('secret');
  });
});
