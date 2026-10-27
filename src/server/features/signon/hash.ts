import { createHash, randomBytes } from 'node:crypto';
import { hmac } from '../../shared/crypto/index.js';

/** The email as it is compared: trimmed and lower-cased. */
export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

export const hashEmail = (email: string, secret: Buffer): string => hmac(normalizeEmail(email), secret);
/** The hash of a client address, in its own `bucket` (sign-up, asks and removals each count separately). */
export const hashIp = (ip: string, secret: Buffer, bucket = ''): string => hmac(bucket ? `${bucket}:${ipKey(ip)}` : ipKey(ip), secret);

/** 32 random bytes as 64 hex characters. Only its sha256 is stored. */
export const newToken = (): string => randomBytes(32).toString('hex');
export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');
export const TOKEN_PATTERN = /^[0-9a-f]{64}$/;

/**
 * The address a request counts under. An IPv4 address (or an IPv4-mapped IPv6 one) stays as it is; an IPv6 address becomes its
 * /64 network (the first four groups, written out in full), since one household or host holds a whole /64 and can vary the rest.
 */
export function ipKey(ip: string): string {
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (mapped) return mapped[1]!;
  if (!ip.includes(':')) return ip;
  const zone = ip.split('%')[0]!;
  const [head, tail] = zone.split('::') as [string, string | undefined];
  const left = head === '' ? [] : head.split(':');
  const right = tail === undefined || tail === '' ? [] : tail.split(':');
  const missing = 8 - left.length - right.length;
  const groups = tail === undefined ? left : [...left, ...Array<string>(Math.max(0, missing)).fill('0'), ...right];
  if (groups.length !== 8 || !groups.every((g) => /^[0-9a-f]{1,4}$/i.test(g))) return ip;
  return `${groups.slice(0, 4).map((g) => g.toLowerCase().padStart(4, '0')).join(':')}::/64`;
}

/** Vercel's own header first (a client cannot set it), then x-real-ip, then the first x-forwarded-for entry. Only its hash is stored. */
export function clientIp(headers: Headers): string {
  return (
    headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() ||
    headers.get('x-real-ip')?.trim() ||
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  );
}
