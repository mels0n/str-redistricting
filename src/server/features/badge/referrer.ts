import { parsePublicHttpsUrl } from '../../shared/ssrf/index.js';

export const MAX_URL_LENGTH = 300;
const MAX_RAW_LENGTH = 2000;

/** The host with a leading "www." removed, for comparing a site with a representative's website. */
export const bareHost = (host: string): string => host.toLowerCase().replace(/^www\./, '');

/**
 * The page a badge request came from, ready to store, or null when it should be ignored. The Referer header is untrusted text, so
 * it is parsed with the URL parser and held to the same rules as anything the server will fetch later: http or https only (stored
 * as https, which is the only way it is ever fetched), default port, no user name or password, a public-looking DNS name. The
 * query and fragment are dropped, our own site is ignored, and an address longer than 300 characters is ignored (never cut).
 * No DNS lookup happens here; that is checked when the page is fetched.
 */
export function normalizeReferrer(raw: string | null | undefined, ownHosts: readonly string[]): { url: string; host: string } | null {
  if (!raw || raw.length > MAX_RAW_LENGTH) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if ((u.protocol !== 'http:' && u.protocol !== 'https:') || u.username !== '' || u.password !== '' || u.port !== '') return null;
  const safe = parsePublicHttpsUrl(`https://${u.hostname}${u.pathname}`);
  if (!safe) return null;
  const own = ownHosts.map(bareHost);
  if (own.includes(bareHost(safe.hostname))) return null;
  const url = `${safe.origin}${safe.pathname}`;
  return url.length > MAX_URL_LENGTH ? null : { url, host: safe.hostname };
}
