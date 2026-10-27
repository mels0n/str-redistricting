/** What the confirmation link's `?signed=` said: the page that opens reads it once. */
export type SignedNotice = 'ok' | 'expired';

let pending: SignedNotice | null = null;

/** Remembers `?signed=1` or `?signed=expired` from a query string before the router rewrites the address. */
export function captureSigned(search: string): void {
  const v = new URLSearchParams(search).get('signed');
  pending = v === '1' ? 'ok' : v === 'expired' ? 'expired' : null;
}

/** The remembered notice, once. */
export function takeSigned(): SignedNotice | null {
  const v = pending;
  pending = null;
  return v;
}
