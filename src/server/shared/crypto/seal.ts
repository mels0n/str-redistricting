import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

const PREFIX = 'v1:';
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** AES-256-GCM. Output is `v1:` + base64(iv | ciphertext | tag); every call uses a fresh IV. */
export function seal(plain: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return PREFIX + Buffer.concat([iv, body, cipher.getAuthTag()]).toString('base64');
}

/** Reverses `seal`. Throws on a wrong key, an altered string or an unknown format. */
export function open(sealed: string, key: Buffer): string {
  if (!sealed.startsWith(PREFIX)) throw new Error('unsupported sealed format');
  const raw = Buffer.from(sealed.slice(PREFIX.length), 'base64');
  if (raw.length < IV_BYTES + TAG_BYTES) throw new Error('sealed value too short');
  const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, IV_BYTES));
  decipher.setAuthTag(raw.subarray(raw.length - TAG_BYTES));
  return Buffer.concat([decipher.update(raw.subarray(IV_BYTES, raw.length - TAG_BYTES)), decipher.final()]).toString('utf8');
}

/** HMAC-SHA256 as lowercase hex. */
export function hmac(value: string, secret: Buffer): string {
  return createHmac('sha256', secret).update(value).digest('hex');
}
