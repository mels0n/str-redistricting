import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

const VERSION = 'v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const B64 = /^[A-Za-z0-9+/]*={0,2}$/;

/** AES-256-GCM. Output is `v1:<iv b64>:<tag b64>:<ciphertext b64>`; every call uses a fresh 12-byte IV. */
export function seal(plain: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [VERSION, iv.toString('base64'), cipher.getAuthTag().toString('base64'), body.toString('base64')].join(':');
}

/** Reverses `seal`. Throws on a wrong key, an altered string, a malformed string or an unknown version. */
export function open(sealed: string, key: Buffer): string {
  const parts = sealed.split(':');
  if (parts.length !== 4 || parts[0] !== VERSION || !parts.slice(1).every((p) => B64.test(p))) throw new Error('unsupported sealed format');
  const [iv, tag, body] = parts.slice(1).map((p) => Buffer.from(p, 'base64')) as [Buffer, Buffer, Buffer];
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw new Error('unsupported sealed format');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
}

/** HMAC-SHA256 as lowercase hex. */
export function hmac(value: string, secret: Buffer): string {
  return createHmac('sha256', secret).update(value).digest('hex');
}
