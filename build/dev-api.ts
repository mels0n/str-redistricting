import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';

/** Named in the dev server's responses so a mocked answer is never mistaken for a real one. */
export const DEV_API_MARK = 'dev-api-mock';

interface Reply {
  status: number;
  body: unknown;
}

const NOTES = [
  { body: 'I want my vote to count the same as my neighbor’s.', name: 'Maria G.', town: 'Denver', at: '2026-10-20T15:00:00.000Z' },
  { body: 'A rule anyone can check is the only kind of map I can trust.', name: null, town: null, at: '2026-10-18T09:30:00.000Z' },
];

/** `low` answers with totals under the site's display threshold, so the hidden-counts state can be seen. */
export type CountsMode = 'high' | 'low';

/** What a person typed decides which answer comes back, so every screen can be reached without a backend. */
export function devReply(method: string, path: string, query: URLSearchParams, body: Record<string, unknown>, mode: CountsMode = 'high'): Reply | null {
  const text = (k: string): string => (typeof body[k] === 'string' ? (body[k] as string) : '');
  if (path === '/api/counts' && method === 'GET') {
    const state = query.get('state');
    const low = (query.get('fakeCounts') ?? mode) === 'low';
    return {
      status: 200,
      body: {
        national: low ? 87 : 1234,
        waiting: low ? 3 : 12,
        ...(state && { state: low ? 5 : state === 'CO' ? 87 : 21, byKey: { [`${state}:us-house:01`]: 12, [`${state}:us-house:08`]: 7, [`${state}:us-senate:state`]: 40, [`${state}:state-senate:031`]: 5, [`${state}:state-house:006`]: 3, [`${state}:us-house:01#asks`]: 4 } }),
      },
    };
  }
  if (path === '/api/notes' && method === 'GET') return { status: 200, body: { notes: NOTES } };
  if (path === '/api/ask' && method === 'POST') return { status: 202, body: { status: 'counted', mark: DEV_API_MARK } };
  if (path === '/api/sign' && method === 'POST') {
    const queued = text('email').includes('queue');
    return { status: 202, body: { status: 'check-email', queued, noteDropped: text('note').includes('link') ? 'a link' : null } };
  }
  if (path === '/api/remove-request' && method === 'POST') return { status: 202, body: { status: 'check-email' } };
  if (path === '/api/remove' && method === 'POST') return { status: 200, body: { status: 'removed' } };
  return null;
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** The dev server serves only the front end, so /api/* would 404. This answers those routes with made-up data. It is never part of a build. */
export function devApi(): Plugin {
  return {
    name: DEV_API_MARK,
    apply: 'serve',
    configureServer(server) {
      // Opening any page with ?fakeCounts=low (or =high) switches the counts the stand-in returns, until the server restarts.
      let mode: CountsMode = 'high';
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        if (!url.pathname.startsWith('/api/')) {
          const flag = url.searchParams.get('fakeCounts');
          if (flag === 'low' || flag === 'high') mode = flag;
          return next();
        }
        const reply = devReply(req.method ?? 'GET', url.pathname, url.searchParams, req.method === 'POST' ? await readJson(req) : {}, mode);
        res.statusCode = reply?.status ?? 404;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(reply?.body ?? { error: 'not-found' }));
      });
    },
  };
}
