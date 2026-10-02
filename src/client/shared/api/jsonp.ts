/**
 * Loads a JSONP response. Used only for the U.S. Census Bureau geocoder,
 * which answers browsers through JSONP but sends no CORS headers for plain
 * JSON. The result is untyped and must be validated by the caller.
 */
let counter = 0;

export class JsonpError extends Error {
  constructor(readonly kind: 'network' | 'timeout') {
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
    const cleanup = (): void => {
      done = true;
      window.clearTimeout(timer);
      script.remove();
      // Leave a no-op behind in case a late response still arrives.
      g[name] = () => undefined;
    };
    const timer = window.setTimeout(() => {
      if (done) return;
      cleanup();
      reject(new JsonpError('timeout'));
    }, timeoutMs);
    g[name] = (data: unknown) => {
      if (done) return;
      cleanup();
      resolve(data);
    };
    script.onerror = () => {
      if (done) return;
      cleanup();
      reject(new JsonpError('network'));
    };
    script.src = target.toString();
    script.async = true;
    script.referrerPolicy = 'no-referrer';
    document.head.append(script);
  });
}
