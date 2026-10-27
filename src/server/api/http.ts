import { SignonError, type SignonErrorCode } from '../shared/errors/signon.js';

const STATUS: Partial<Record<SignonErrorCode, number>> = {
  'bad-request': 400,
  'bot-check': 403,
  'rate-limit': 429,
  'address-not-found': 422,
  'outside-states': 422,
  'token-invalid': 400,
  'token-expired': 410,
};

export interface RequestContext {
  requestId: string;
}

/** Wraps a handler: sets the request id, turns errors into `{ error: code }` with a status, and logs the id and code only (never the body). */
export function handle(fn: (req: Request, ctx: RequestContext) => Promise<Response>): (req: Request) => Promise<Response> {
  return async (req) => {
    const requestId = req.headers.get('x-request-id') || crypto.randomUUID();
    let res: Response;
    try {
      res = await fn(req, { requestId });
    } catch (err) {
      const code: SignonErrorCode = err instanceof SignonError ? err.code : 'unavailable';
      console.error(JSON.stringify({ requestId, code }));
      res = Response.json({ error: code }, { status: STATUS[code] ?? 503 });
    }
    const out = new Response(res.body, res);
    out.headers.set('x-request-id', requestId);
    return out;
  };
}
