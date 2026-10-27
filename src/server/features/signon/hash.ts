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

/** The first address in x-forwarded-for, else x-real-ip, else a fixed label. Only its hash is stored. */
export function clientIp(headers: Headers): string {
  return headers.get('x-forwarded-for')?.split(',')[0]?.trim() || headers.get('x-real-ip')?.trim() || 'unknown';
}
