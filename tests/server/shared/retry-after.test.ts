import { describe, expect, it } from 'vitest';
import { retryAfterMs, retryWaitMs } from '../../../src/server/shared/http/index.js';

const res = (status: number, retryAfter?: string): Response => new Response(null, { status, headers: retryAfter === undefined ? {} : { 'retry-after': retryAfter } });

describe('retryAfterMs', () => {
  it('reads whole seconds on a 429 or 503, capped at 60 s', () => {
    expect(retryAfterMs(res(429, '5'))).toBe(5000);
    expect(retryAfterMs(res(503, '3600'))).toBe(60_000);
    expect(retryAfterMs(res(429, '0'))).toBe(0);
  });
  it('ignores an HTTP date, junk, a missing header and other statuses', () => {
    expect(retryAfterMs(res(429, 'Wed, 21 Oct 2026 07:28:00 GMT'))).toBeUndefined();
    expect(retryAfterMs(res(429, 'soon'))).toBeUndefined();
    expect(retryAfterMs(res(429, '-5'))).toBeUndefined();
    expect(retryAfterMs(res(503))).toBeUndefined();
    expect(retryAfterMs(res(500, '5'))).toBeUndefined();
  });
});

describe('retryWaitMs', () => {
  it('is the backoff unless the server asked for longer', () => {
    expect(retryWaitMs(2000, undefined)).toBe(2000);
    expect(retryWaitMs(2000, 0)).toBe(2000);
    expect(retryWaitMs(2000, 5000)).toBe(5000);
  });
});
