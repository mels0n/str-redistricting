/**
 * Routes. Everything a visitor can share lives in the address, as a path:
 *
 *   /                          national index
 *   /how                       how the maps are drawn
 *   /changelog                 release notes for maps, engine and input
 *   /how/balancing             the same page, at one of its sections
 *   /faq                       common questions
 *   /faq/ties                  the same page, at one question
 *   /house  /senate            national index for the State House or State Senate
 *   /CO                        Colorado, finished map
 *   /CO/senate/d/12            Colorado State Senate, district 12 (also /house)
 *   /CO/d/3                    Colorado, district 3 selected
 *   /CO/cut/4                  Colorado, cut sequence at cut 4
 *   /CO/balance/12             Colorado, balancing replay after move 12
 *   /CO/d/3?plan=before&compare=enacted
 *
 * Hash routes (`#/CO/d/3`) use the same grammar behind a `#`. They are the
 * embedding mode: inside a host page the viewer cannot own the path, so it
 * switches to hash links with `setRouteMode('hash')`, and old hash links
 * keep working everywhere.
 *
 * `plan=finished` and the older `plan=official` both open the finished map,
 * which is also what a link without `plan` shows.
 */
import { chamberOfSegment, CHAMBERS, type Chamber } from './chamber';

export type Plan = 'finished' | 'before';

/** Sections of the How it works page, in page order. */
export const HOW_SECTIONS = ['inputs', 'cut', 'strays', 'recursion', 'balancing', 'fingerprint', 'sources'] as const;
export type HowSection = (typeof HOW_SECTIONS)[number];

/** Questions on the FAQ page, in page order. */
export const FAQ_QUESTIONS = ['gerrymandering', 'stop', 'today', 'strange', 'block', 'ties', 'data', 'counties', 'equal', 'current', 'water', 'one-seat', 'state-laws', 'check', 'terms'] as const;
export type FaqQuestion = (typeof FAQ_QUESTIONS)[number];

export type Route =
  | { page: 'national'; chamber: Chamber }
  | { page: 'how'; section: HowSection | null }
  | { page: 'faq'; question: FaqQuestion | null }
  | { page: 'changelog' }
  | {
      page: 'state';
      abbr: string;
      chamber: Chamber;
      district: number | null;
      /** null unless the cut sequence is open; 0..N-1 in the cut sequence. */
      cut: number | null;
      /** null unless the balancing replay is open; m = the first m balancing moves made (0..M). */
      move: number | null;
      plan: Plan;
      enacted: boolean;
    };

export const NATIONAL: Route = { page: 'national', chamber: 'federal-house' };

export function nationalRoute(chamber: Chamber = 'federal-house'): Route {
  return { page: 'national', chamber };
}
export const CHANGELOG: Route = { page: 'changelog' };

export function howRoute(section: HowSection | null = null): Route {
  return { page: 'how', section };
}

export function faqRoute(question: FaqQuestion | null = null): Route {
  return { page: 'faq', question };
}

export function stateRoute(abbr: string, patch: Partial<StateRoute> = {}): StateRoute {
  return { page: 'state', abbr, chamber: 'federal-house', district: null, cut: null, move: null, plan: 'finished', enacted: false, ...patch };
}

function positiveInt(s: string | undefined, min: number, digits = 3): number | null {
  if (s === undefined || s.length > digits || !/^\d+$/.test(s)) return null;
  const n = Number(s);
  return n >= min ? n : null;
}

/** Reads a `plan` value. `official` is an older name for the finished map and still opens it. */
export function parsePlan(value: string | null): Plan {
  return value === 'before' ? 'before' : 'finished';
}

export function parsePath(pathname: string, search: string): Route {
  const segs = pathname.split('/').filter(Boolean);
  if (segs[0]?.toLowerCase() === 'how') {
    const section = segs[1]?.toLowerCase();
    // Why a district looks strange was a How it works section before it moved to the FAQ; old links still land on it.
    if (section === 'strange') return faqRoute('strange');
    return howRoute((HOW_SECTIONS as readonly string[]).includes(section ?? '') ? (section as HowSection) : null);
  }
  if (segs[0]?.toLowerCase() === 'faq') {
    const question = segs[1]?.toLowerCase();
    return faqRoute((FAQ_QUESTIONS as readonly string[]).includes(question ?? '') ? (question as FaqQuestion) : null);
  }
  if (segs[0]?.toLowerCase() === 'changelog') return CHANGELOG;
  const nationalChamber = chamberOfSegment(segs[0]);
  if (nationalChamber) return nationalRoute(nationalChamber);
  const abbr = segs[0]?.toUpperCase();
  if (!abbr || !/^[A-Z]{2}$/.test(abbr)) return NATIONAL;

  // A chamber segment may follow the state; without one the route is the federal House, as every older link is.
  const chamber = chamberOfSegment(segs[1]);
  const rest = chamber ? 2 : 1;

  let district: number | null = null;
  let cut: number | null = null;
  let move: number | null = null;
  for (let i = rest; i < segs.length; i += 2) {
    const key = segs[i];
    const value = segs[i + 1];
    if (key === 'd') district = positiveInt(value, 1);
    else if (key === 'cut') cut = positiveInt(value, 0);
    else if (key === 'balance') move = positiveInt(value, 0, 4);
  }
  // The two phases of the sequence never show at once; the cuts come first.
  if (cut !== null) move = null;
  const q = new URLSearchParams(search);
  return stateRoute(abbr, {
    chamber: chamber ?? 'federal-house',
    district,
    cut,
    move,
    plan: parsePlan(q.get('plan')),
    enacted: q.get('compare') === 'enacted',
  });
}

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#/, '');
  const i = raw.indexOf('?');
  return i < 0 ? parsePath(raw, '') : parsePath(raw.slice(0, i), raw.slice(i));
}

function chamberSegment(chamber: Chamber): string {
  return CHAMBERS.find((c) => c.key === chamber)?.segment ?? '';
}

export function formatPath(route: Route): string {
  if (route.page === 'national') return `/${chamberSegment(route.chamber)}`;
  if (route.page === 'changelog') return '/changelog';
  if (route.page === 'how') return route.section ? `/how/${route.section}` : '/how';
  if (route.page === 'faq') return route.question ? `/faq/${route.question}` : '/faq';
  let path = `/${route.abbr}`;
  if (route.chamber !== 'federal-house') path += `/${chamberSegment(route.chamber)}`;
  if (route.district !== null) path += `/d/${route.district}`;
  if (route.cut !== null) path += `/cut/${route.cut}`;
  else if (route.move !== null) path += `/balance/${route.move}`;
  const q = new URLSearchParams();
  if (route.plan === 'before') q.set('plan', 'before');
  if (route.enacted) q.set('compare', 'enacted');
  const qs = q.toString();
  return qs ? `${path}?${qs}` : path;
}

export function formatHash(route: Route): string {
  return '#' + formatPath(route);
}

/** How links are written: real paths, or hashes when the viewer is embedded in a page it does not own. */
export type RouteMode = 'path' | 'hash';
let routeMode: RouteMode = 'path';

export function setRouteMode(mode: RouteMode): void {
  routeMode = mode;
}

export function getRouteMode(): RouteMode {
  return routeMode;
}

/** The href for a link to a route, in the current route mode. */
export function routeHref(route: Route): string {
  return routeMode === 'hash' ? formatHash(route) : formatPath(route);
}

/** The page's indexable address: no query, district, cut or move. */
export function canonicalPath(route: Route): string {
  if (route.page === 'how') return '/how';
  if (route.page === 'faq') return '/faq';
  if (route.page === 'changelog') return '/changelog';
  if (route.page === 'national') return `/${chamberSegment(route.chamber)}`;
  const chamber = route.chamber === 'federal-house' ? '' : `/${chamberSegment(route.chamber)}`;
  return `/${route.abbr}${chamber}`;
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

export type StateRoute = Extract<Route, { page: 'state' }>;

/** Something in a link that does not fit the state it names. */
export type RouteIssue =
  | { kind: 'district'; district: number; seats: number }
  | { kind: 'cut'; cut: number; cuts: number }
  | { kind: 'move'; move: number; moves: number };

/**
 * Brings a state route in line with what the state actually has: a district
 * past the last one is dropped, a cut or balancing move past the last one
 * becomes the last (or is dropped when there are none). `moves` is the number of balancing moves, when known.
 * Returns the corrected route and what was wrong, so the page can say so.
 */
export function fitRouteToState(route: StateRoute, seats: number, moves?: number): { route: StateRoute; issues: RouteIssue[] } {
  const issues: RouteIssue[] = [];
  const cuts = Math.max(seats - 1, 0);
  let { district, cut, move } = route;
  if (district !== null && district > seats) {
    issues.push({ kind: 'district', district, seats });
    district = null;
  }
  // With no cuts to show (one seat) even cut 0 is wrong: there is no sequence to open.
  if (cut !== null && (cut > cuts || cuts === 0)) {
    issues.push({ kind: 'cut', cut, cuts });
    cut = cuts === 0 ? null : cuts;
  }
  // Likewise with no balancing moves, even move 0 is wrong.
  if (move !== null && moves !== undefined && (move > moves || moves === 0)) {
    issues.push({ kind: 'move', move, moves });
    move = moves === 0 ? null : moves;
  }
  return { route: issues.length ? { ...route, district, cut, move } : route, issues };
}

/** Plain-language sentence for a link problem. */
export function describeRouteIssue(issue: RouteIssue, stateName: string): string {
  if (issue.kind === 'district') {
    return `${stateName} has ${issue.seats} ${issue.seats === 1 ? 'district' : 'districts'}, so there is no District ${issue.district}. Showing the whole state.`;
  }
  if (issue.kind === 'move') {
    return issue.moves === 0
      ? `${stateName} needed no balancing moves, so there is no balancing to show.`
      : `${stateName} has ${issue.moves} balancing ${issue.moves === 1 ? 'move' : 'moves'}, so there is no move ${issue.move}. Showing the last one.`;
  }
  return issue.cuts === 0
    ? `${stateName} is a single district, so there are no cuts to show.`
    : `${stateName} has ${issue.cuts} ${issue.cuts === 1 ? 'cut' : 'cuts'}, so there is no cut ${issue.cut}. Showing the last one.`;
}
