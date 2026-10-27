import { describe, expect, it } from 'vitest';
import { loadBackendConfig } from '../../src/server/shared/config/backend.js';
import { hmac, open, seal } from '../../src/server/shared/crypto/index.js';

const k = (n: number) => Buffer.alloc(32, n).toString('base64');
const GOOD = {
  NEXT_PUBLIC_BACKERS_SUPABASE_URL: 'https://example.supabase.co',
  BACKERS_SUPABASE_SECRET_KEY: 'sb-secret-value',
  RESEND_API_KEY: 're-secret-value',
  TURNSTILE_SECRET_KEY: 'ts-secret-value',
  SIGNON_HASH_SECRET: k(1),
  SIGNON_ENCRYPTION_KEY: k(2),
};

describe('loadBackendConfig', () => {
  it('names the missing keys and no values', () => {
    let message = '';
    try { loadBackendConfig({}); } catch (e) { message = (e as Error).message; }
    for (const name of Object.keys(GOOD)) expect(message).toContain(name);
  });
  it('rejects a key that is not 32 bytes without echoing it', () => {
    const short = Buffer.alloc(16, 9).toString('base64');
    let message = '';
    try { loadBackendConfig({ ...GOOD, SIGNON_HASH_SECRET: short }); } catch (e) { message = (e as Error).message; }
    expect(message).toContain('SIGNON_HASH_SECRET');
    expect(message).not.toContain(short);
  });
  it('applies defaults and decodes keys', () => {
    const c = loadBackendConfig(GOOD);
    expect(c.from).toBe('Fair Maps <signon@fairmaps.melson.us>');
    expect(c.siteOrigin).toBe('https://fairmaps.melson.us');
    expect(c.hashSecret.length).toBe(32);
    expect(c.encryptionKey.equals(Buffer.alloc(32, 2))).toBe(true);
  });
});

describe('crypto', () => {
  const key = Buffer.alloc(32, 7);
  it('round-trips and uses a fresh IV', () => {
    const a = seal('Ada Lovelace', key);
    expect(open(a, key)).toBe('Ada Lovelace');
    expect(seal('Ada Lovelace', key)).not.toBe(a);
    expect(a.startsWith('v1:')).toBe(true);
    expect(a).not.toContain('Ada');
  });
  it('rejects the wrong key and any altered ciphertext', () => {
    const a = seal('hello', key);
    expect(() => open(a, Buffer.alloc(32, 8))).toThrow();
    const i = a.length - 6;
    const altered = a.slice(0, i) + (a[i] === 'A' ? 'B' : 'A') + a.slice(i + 1);
    expect(() => open(altered, key)).toThrow();
  });
  it('hmac is stable hex', () => {
    expect(hmac('x', key)).toMatch(/^[0-9a-f]{64}$/);
    expect(hmac('x', key)).toBe(hmac('x', key));
    expect(hmac('x', key)).not.toBe(hmac('y', key));
  });
});
