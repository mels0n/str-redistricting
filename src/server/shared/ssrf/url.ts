import { isIP } from 'node:net';

/** Top-level names that never name a public site. */
const BLOCKED_TLDS = new Set(['localhost', 'local', 'internal', 'lan', 'home', 'corp', 'intranet', 'localdomain', 'private', 'test', 'invalid', 'example', 'onion', 'arpa']);

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** True for a lower-case DNS name that could be a public site: dotted, letters/digits/hyphens, a non-numeric last label, no reserved ending. Never an IP address. */
export function isPublicHostname(host: string): boolean {
  if (host.length === 0 || host.length > 253 || isIP(host) !== 0 || host.startsWith('[')) return false;
  const labels = host.split('.');
  if (labels.length < 2 || !labels.every((l) => LABEL.test(l))) return false;
  const tld = labels[labels.length - 1]!;
  return /^[a-z]/.test(tld) && !BLOCKED_TLDS.has(tld);
}

/**
 * The URL if it may ever be fetched from the server, else null: https only, port 443, no user name or password, and a host that is a
 * public-looking DNS name. This is the part of the guard that needs no DNS lookup; the fetcher also checks the addresses.
 */
export function parsePublicHttpsUrl(raw: string): URL | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.username !== '' || u.password !== '' || (u.port !== '' && u.port !== '443')) return null;
  return isPublicHostname(u.hostname) ? u : null;
}
