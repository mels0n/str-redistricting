/** What the confirmation link's `?signed=` said: the page that opens reads it once. */
export type SignedNotice = 'ok' | 'expired' | 'invalid';

let pending: SignedNotice | null = null;

/** Remembers `?signed=1`, `?signed=expired` or `?signed=invalid` from a query string before the router rewrites the address. */
export function captureSigned(search: string): void {
  const v = new URLSearchParams(search).get('signed');
  pending = v === '1' ? 'ok' : v === 'expired' ? 'expired' : v === 'invalid' ? 'invalid' : null;
}

/** The remembered notice, once. */
export function takeSigned(): SignedNotice | null {
  const v = pending;
  pending = null;
  return v;
}
