import { createHash, randomBytes } from 'node:crypto';
import { hmac } from '../../shared/crypto/index.js';

/** The email as it is compared: trimmed and lower-cased. */
export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

export const hashEmail = (email: string, secret: Buffer): string => hmac(normalizeEmail(email), secret);
export const hashIp = (ip: string, secret: Buffer): string => hmac(ip, secret);

/** 32 random bytes as 64 hex characters. Only its sha256 is stored. */
export const newToken = (): string => randomBytes(32).toString('hex');
export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');
export const TOKEN_PATTERN = /^[0-9a-f]{64}$/;

/** Vercel's own header first (a client cannot set it), then x-real-ip, then the first x-forwarded-for entry. Only its hash is stored. */
export function clientIp(headers: Headers): string {
  return (
    headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() ||
    headers.get('x-real-ip')?.trim() ||
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  );
}
