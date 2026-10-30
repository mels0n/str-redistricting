import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request } from 'node:https';
import { isPublicAddress } from './address.js';
import { parsePublicHttpsUrl } from './url.js';

export type SsrfCode = 'bad-url' | 'private-address' | 'dns' | 'redirects' | 'timeout' | 'network';

/** A fetch that was refused or failed. Only the code is meant to be logged: never the address, the headers or the body. */
export class SsrfError extends Error {
  constructor(readonly code: SsrfCode) {
    super(code);
    this.name = 'SsrfError';
  }
}

export interface FetchPublicOptions {
  userAgent: string;
  /** Covers every redirect hop together. */
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  accept?: string;
  /** Every address a name has. Tests replace it. */
  resolve?: (host: string) => Promise<string[]>;
  /** One request to one already-checked address. Tests replace it. */
  transport?: Transport;
}

export interface TransportRequest {
  url: URL;
  address: string;
  headers: Record<string, string>;
  timeoutMs: number;
  maxBytes: number;
}
export interface TransportResponse {
  status: number;
  location: string | null;
  contentType: string | null;
  body: string;
}
export type Transport = (req: TransportRequest) => Promise<TransportResponse>;

export interface FetchedPage {
  status: number;
  /** The address after redirects. */
  url: string;
  contentType: string | null;
  /** The first `maxBytes` of the body as text. */
  body: string;
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

async function resolveAll(host: string): Promise<string[]> {
  return (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);
}

/**
 * One GET over TLS to an address that was checked a moment ago. The connection is made to that address, not to the name, so the name
 * cannot resolve to something else between the check and the connect; the certificate is still checked against the name.
 * Nothing is sent that identifies a visitor (no cookies, no referrer), and the body is cut off once it reaches `maxBytes`.
 */
export const httpsTransport: Transport = (r) =>
  new Promise((resolve, reject) => {
    const req = request(
      { host: r.address, port: 443, servername: r.url.hostname, path: `${r.url.pathname}${r.url.search}`, method: 'GET', headers: { ...r.headers, host: r.url.hostname }, agent: false },
      (res) => {
        const status = res.statusCode ?? 0;
        const location = typeof res.headers.location === 'string' ? res.headers.location : null;
        const contentType = typeof res.headers['content-type'] === 'string' ? res.headers['content-type'] : null;
        if (status < 200 || status >= 300) {
          res.destroy();
          resolve({ status, location, contentType, body: '' });
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        const done = (): void => resolve({ status, location, contentType, body: Buffer.concat(chunks).subarray(0, r.maxBytes).toString('utf8') });
        res.on('data', (c: Buffer) => {
          chunks.push(c);
          size += c.length;
          if (size >= r.maxBytes) {
            res.destroy();
            done();
          }
        });
        res.on('end', done);
        res.on('error', () => reject(new SsrfError('network')));
      },
    );
    // A hard limit on the whole exchange, so a server that trickles its answer cannot hold the function open.
    const timer = setTimeout(() => req.destroy(new SsrfError('timeout')), r.timeoutMs);
    req.on('close', () => clearTimeout(timer));
    req.on('error', (e) => reject(e instanceof SsrfError ? e : new SsrfError('network')));
    req.end();
  });

/** The promise's answer, or SsrfError('timeout') once `ms` have passed. */
function withDeadline<T>(p: Promise<T>, ms: number): Promise<T> {
  if (ms <= 0) return Promise.reject(new SsrfError('timeout'));
  let timer: ReturnType<typeof setTimeout>;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new SsrfError('timeout')), ms);
  });
  p.catch(() => undefined);
  return Promise.race([p, late]).finally(() => clearTimeout(timer));
}

/**
 * Fetches a page the server was handed by a stranger. Refuses anything but a public https site on port 443; looks up the name
 * itself and refuses it if ANY address is private, loopback, link-local, shared, multicast or otherwise not public; connects to
 * the checked address; follows at most `maxRedirects` redirects and applies the same checks to every hop. Throws SsrfError.
 */
export async function fetchPublic(raw: string, opts: FetchPublicOptions): Promise<FetchedPage> {
  const resolve = opts.resolve ?? resolveAll;
  const transport = opts.transport ?? httpsTransport;
  const maxRedirects = opts.maxRedirects ?? 3;
  const maxBytes = opts.maxBytes ?? 1_048_576;
  const deadline = Date.now() + (opts.timeoutMs ?? 5000);
  let current = raw;
  for (let hop = 0; ; hop++) {
    const url = parsePublicHttpsUrl(current);
    if (!url) throw new SsrfError('bad-url');
    let addresses: string[];
    try {
      // A name server that never answers must not hold the call past its time.
      addresses = await withDeadline(resolve(url.hostname), deadline - Date.now());
    } catch (e) {
      throw e instanceof SsrfError ? e : new SsrfError('dns');
    }
    if (addresses.length === 0) throw new SsrfError('dns');
    if (!addresses.every(isPublicAddress)) throw new SsrfError('private-address');
    // Every address is public here; IPv4 first, as the more widely reachable.
    addresses = [...addresses].sort((a, b) => Number(isIP(b) === 4) - Number(isIP(a) === 4));
    const left = deadline - Date.now();
    if (left <= 0) throw new SsrfError('timeout');
    const res = await transport({
      url,
      address: addresses[0]!,
      headers: { 'user-agent': opts.userAgent, accept: opts.accept ?? 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1', 'accept-encoding': 'identity' },
      timeoutMs: left,
      maxBytes,
    });
    if (REDIRECTS.has(res.status) && res.location) {
      if (hop >= maxRedirects) throw new SsrfError('redirects');
      try {
        current = new URL(res.location, url).href;
      } catch {
        throw new SsrfError('bad-url');
      }
      continue;
    }
    return { status: res.status, url: url.href, contentType: res.contentType, body: res.body };
  }
}
