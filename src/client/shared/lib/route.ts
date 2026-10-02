/**
 * Hash routes. Everything a visitor can share lives in the hash, so the viewer
 * works on any static host and inside an embedding page:
 *
 *   #/                          national index
 *   #/CO                        Colorado, finished map
 *   #/CO/d/3                    Colorado, district 3 selected
 *   #/CO/cut/4                  Colorado, cut sequence at cut 4
 *   #/CO/d/3?plan=before&compare=enacted
 */
export type Plan = 'official' | 'before';

export type Route =
  | { page: 'national' }
  | {
      page: 'state';
      abbr: string;
      district: number | null;
      /** null when the finished map is showing; 0..N-1 in the cut sequence. */
      cut: number | null;
      plan: Plan;
      enacted: boolean;
    };

export const NATIONAL: Route = { page: 'national' };

export function stateRoute(abbr: string, patch: Partial<Extract<Route, { page: 'state' }>> = {}): Route {
  return { page: 'state', abbr, district: null, cut: null, plan: 'official', enacted: false, ...patch };
}

function positiveInt(s: string | undefined, min: number): number | null {
  if (s === undefined || !/^\d{1,3}$/.test(s)) return null;
  const n = Number(s);
  return n >= min ? n : null;
}

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#/, '');
  const [pathPart = '', queryPart = ''] = raw.split('?', 2);
  const segs = pathPart.split('/').filter(Boolean);
  const abbr = segs[0]?.toUpperCase();
  if (!abbr || !/^[A-Z]{2}$/.test(abbr)) return NATIONAL;

  let district: number | null = null;
  let cut: number | null = null;
  for (let i = 1; i < segs.length; i += 2) {
    const key = segs[i];
    const value = segs[i + 1];
    if (key === 'd') district = positiveInt(value, 1);
    else if (key === 'cut') cut = positiveInt(value, 0);
  }
  const q = new URLSearchParams(queryPart);
  return stateRoute(abbr, {
    district,
    cut,
    plan: q.get('plan') === 'before' ? 'before' : 'official',
    enacted: q.get('compare') === 'enacted',
  });
}

export function formatHash(route: Route): string {
  if (route.page === 'national') return '#/';
  let path = `#/${route.abbr}`;
  if (route.district !== null) path += `/d/${route.district}`;
  if (route.cut !== null) path += `/cut/${route.cut}`;
  const q = new URLSearchParams();
  if (route.plan === 'before') q.set('plan', 'before');
  if (route.enacted) q.set('compare', 'enacted');
  const qs = q.toString();
  return qs ? `${path}?${qs}` : path;
}

export function sameState(a: Route, b: Route): boolean {
  return a.page === 'state' && b.page === 'state' && a.abbr === b.abbr;
}

/** How a page asks the app to change the route. `replace` keeps history short while scrubbing. */
export type Navigate = (route: Route, opts?: { replace?: boolean }) => void;

/** What every page gives the app. */
export interface Page {
  el: HTMLElement;
  /** Element to move focus to after navigation. */
  focusTarget(): HTMLElement | null;
  /** Called with a new route for the same page; return false to be rebuilt instead. */
  update?(route: Route): boolean;
  destroy(): void;
}
