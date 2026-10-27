import { describe, expect, it } from 'vitest';
import { loadBackendConfig, loadDbConfig } from '../../src/server/shared/config/backend.js';
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

describe('mail quota settings', () => {
  it('defaults the daily cap to 20 and leaves the cron secret unset', () => {
    const c = loadBackendConfig(GOOD);
    expect(c.emailDailyCap).toBe(20);
    expect(c.cronSecret).toBeUndefined();
  });
  it('reads EMAIL_DAILY_CAP and CRON_SECRET and rejects a bad cap', () => {
    const c = loadBackendConfig({ ...GOOD, EMAIL_DAILY_CAP: '5', CRON_SECRET: 'x' });
    expect(c.emailDailyCap).toBe(5);
    expect(c.cronSecret).toBe('x');
    expect(() => loadBackendConfig({ ...GOOD, EMAIL_DAILY_CAP: '0' })).toThrow('EMAIL_DAILY_CAP');
  });
});

describe('sender address', () => {
  it('keeps the default and accepts addr@host or Name <addr@host>', () => {
    expect(loadBackendConfig(GOOD).from).toBe('Fair Maps <signon@fairmaps.melson.us>');
    expect(loadBackendConfig({ ...GOOD, SIGNON_FROM: 'signon@fairmaps.melson.us' }).from).toBe('signon@fairmaps.melson.us');
    expect(loadBackendConfig({ ...GOOD, SIGNON_FROM: 'Fair Maps <a@b.co>' }).from).toBe('Fair Maps <a@b.co>');
  });
  it.each(['', 'Fair Maps', 'a@', '@b.co', 'Fair Maps <a@b.co', 'Fair Maps a@b.co>', '<a@b.co>', 'a@b.co, c@d.co', 'Fair <a@b.co>' + String.fromCharCode(10) + 'Bcc: x@y.z'])('rejects %j', (from) => {
    expect(() => loadBackendConfig({ ...GOOD, SIGNON_FROM: from })).toThrow('SIGNON_FROM');
  });
});

describe('url rules', () => {
  it('requires https for the Supabase URL and the site origin', () => {
    expect(() => loadBackendConfig({ ...GOOD, NEXT_PUBLIC_BACKERS_SUPABASE_URL: 'http://example.supabase.co' })).toThrow('NEXT_PUBLIC_BACKERS_SUPABASE_URL');
    expect(() => loadBackendConfig({ ...GOOD, SITE_ORIGIN: 'http://example.com' })).toThrow('SITE_ORIGIN');
    expect(loadBackendConfig({ ...GOOD, SITE_ORIGIN: 'http://localhost:5173' }).siteOrigin).toBe('http://localhost:5173');
  });
  it('loads the database settings without the other keys', () => {
    const c = loadDbConfig({ NEXT_PUBLIC_BACKERS_SUPABASE_URL: GOOD.NEXT_PUBLIC_BACKERS_SUPABASE_URL, BACKERS_SUPABASE_SECRET_KEY: 'x' });
    expect(c.supabaseUrl).toBe('https://example.supabase.co');
    expect(() => loadDbConfig({})).toThrow('BACKERS_SUPABASE_SECRET_KEY');
  });
});

describe('crypto', () => {
  const key = Buffer.alloc(32, 7);
  it('round-trips and uses a fresh IV', () => {
    const a = seal('Ada Lovelace', key);
    expect(open(a, key)).toBe('Ada Lovelace');
    expect(seal('Ada Lovelace', key)).not.toBe(a);
    expect(a).toMatch(/^v1:[A-Za-z0-9+/]+=*:[A-Za-z0-9+/]+=*:[A-Za-z0-9+/]+=*$/);
    const [, iv, tag] = a.split(':');
    expect(Buffer.from(iv!, 'base64')).toHaveLength(12);
    expect(Buffer.from(tag!, 'base64')).toHaveLength(16);
    expect(a).not.toContain('Ada');
  });
  it('rejects the wrong key and any altered ciphertext', () => {
    const a = seal('hello', key);
    expect(() => open(a, Buffer.alloc(32, 8))).toThrow();
    const parts = a.split(':');
    for (const idx of [1, 2, 3]) {
      const bytes = Buffer.from(parts[idx]!, 'base64');
      bytes[0] = bytes[0]! ^ 1;
      const altered = [...parts];
      altered[idx] = bytes.toString('base64');
      expect(() => open(altered.join(':'), key)).toThrow();
    }
  });
  it('seals the empty string', () => {
    expect(open(seal('', key), key)).toBe('');
  });
  it('rejects malformed and unknown-version strings', () => {
    const a = seal('hello', key);
    for (const bad of ['', 'v1:', 'v1:a:b', a.replace('v1:', 'v2:'), a + ':extra', 'v1:!!:!!:!!']) {
      expect(() => open(bad, key), bad).toThrow('unsupported sealed format');
    }
  });
  it('hmac is stable hex', () => {
    expect(hmac('x', key)).toMatch(/^[0-9a-f]{64}$/);
    expect(hmac('x', key)).toBe(hmac('x', key));
    expect(hmac('x', key)).not.toBe(hmac('y', key));
  });
});
