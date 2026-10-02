/**
 * Loads a JSONP response. Used only for the U.S. Census Bureau geocoder,
 * which answers browsers through JSONP but sends no CORS headers for plain
 * JSON. The result is untyped and must be validated by the caller.
 *
 * Whatever happens (answer, script error, script that loads without calling
 * back, timeout), the script tag is removed and the temporary global
 * callback is deleted, so repeated lookups leave nothing behind.
 */
let counter = 0;

export type JsonpFailure = 'network' | 'timeout' | 'no-callback';

export class JsonpError extends Error {
  constructor(readonly kind: JsonpFailure) {
    super(`JSONP ${kind}`);
  }
}

export function jsonp(url: string, params: Record<string, string>, timeoutMs: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const name = `__strvGeo${Date.now().toString(36)}${(counter++).toString(36)}`;
    const target = new URL(url);
    for (const [k, v] of Object.entries(params)) target.searchParams.set(k, v);
    target.searchParams.set('format', 'jsonp');
    target.searchParams.set('callback', name);

    const script = document.createElement('script');
    const g = globalThis as unknown as Record<string, unknown>;
    let done = false;
    const cleanup = (late = false): void => {
      done = true;
      window.clearTimeout(timer);
      script.onerror = null;
      script.onload = null;
      script.remove();
      // After a failure a late answer may still arrive; a stub absorbs it and removes itself.
      if (late) g[name] = () => delete g[name];
      else delete g[name];
    };
    const fail = (kind: JsonpFailure): void => {
      if (done) return;
      cleanup(kind === 'timeout');
      reject(new JsonpError(kind));
    };
    const timer = window.setTimeout(() => fail('timeout'), timeoutMs);
    g[name] = (data: unknown) => {
      if (done) return;
      cleanup();
      resolve(data);
    };
    script.onerror = () => fail('network');
    // A script runs before its load event, so reaching this point with the callback
    // still pending means the answer was not JSONP (for example an error page).
    script.onload = () => fail('no-callback');
    script.src = target.toString();
    script.async = true;
    script.referrerPolicy = 'no-referrer';
    document.head.append(script);
  });
}
