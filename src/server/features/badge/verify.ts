import type { BadgeRepo, Sighting } from '../../entities/badge-db/index.js';
import { fetchPublic, parsePublicHttpsUrl, SsrfError, type FetchedPage } from '../../shared/ssrf/index.js';
import { scanForBadge } from './html.js';
import { bareHost } from './referrer.js';
import { CHECKER_NAME, robotsAllows } from './robots.js';

/** The User-Agent of the checker, naming the page that explains it. */
export const checkerUserAgent = (siteHost: string): string => `${CHECKER_NAME} (+https://${siteHost}/pledges)`;
/** The most sites one daily run looks at. */
export const SITES_PER_RUN = 100;
/** Sites fetched at the same time in the daily run. */
export const CHECK_CONCURRENCY = 5;
/** Time, counted from the start of the cron call, after which the daily run starts no new site (the function itself is allowed 60 seconds). */
export const RUN_BUDGET_MS = 40_000;
/** The most one site may take in all (its robots.txt, two pages, every redirect). */
export const SITE_CHECK_MS = 8000;
/** A page is looked at again by the daily run when its last check is older than this. */
export const CHECK_EVERY_MS = 20 * 3_600_000;
/** Checks started right after a badge request, across the whole site. Beyond this a page waits for the daily run. */
export const IMMEDIATE_CHECKS_PER_HOUR = 60;
export const FORGET_AFTER_MS = 60 * 86_400_000;

export type FetchPage = (url: string, accept?: string) => Promise<FetchedPage>;

/** The real fetch: public https sites only, 5 seconds, 1 MB, three redirects, each hop checked. */
export const fetchPageFor = (siteHost: string): FetchPage => (url, accept) => fetchPublic(url, { userAgent: checkerUserAgent(siteHost), timeoutMs: 5000, maxBytes: 1_048_576, maxRedirects: 3, ...(accept ? { accept } : {}) });

export interface CheckContext {
  repo: BadgeRepo;
  /** Our own host, the one a page must show the badge from and link to. */
  siteHost: string;
  now: () => Date;
  fetchPage?: FetchPage;
  /** Logs a code only: never an address, a header or a body. */
  log?: (code: string) => void;
  /** Replaces SITE_CHECK_MS (tests). */
  siteCheckMs?: number;
}

export interface VerifyDeps extends CheckContext {
  /** Epoch milliseconds after which no new site is started. */
  deadline: number;
  sitesPerRun?: number;
}

export type CheckOutcome = 'verified' | 'failed';
export interface CheckFinding {
  outcome: CheckOutcome;
  title: string | null;
  /** The page the badge was found on. */
  foundUrl: string | null;
}

type Robots = (host: string) => Promise<string | null>;
const defaultLog = (code: string): void => console.error(JSON.stringify({ badgeCheck: code }));
const codeOf = (e: unknown): string => (e instanceof SsrfError ? e.code : 'error');

/** The text of a site's robots.txt, or null when it has none we can read (which allows the check). One fetch per host per run. */
function robotsLoader(get: FetchPage): Robots {
  const seen = new Map<string, Promise<string | null>>();
  return (host) => {
    let p = seen.get(host);
    if (!p) {
      p = get(`https://${host}/robots.txt`, 'text/plain,*/*;q=0.1').then(
        (r) => (r.status >= 200 && r.status < 300 ? r.body : null),
        () => null,
      );
      seen.set(host, p);
    }
    return p;
  };
}

/** The pages to look at: the stored page first (it is where the badge was seen), then the site's home page. */
function pagesOf(url: URL): string[] {
  const home = `${url.origin}/`;
  return url.href === home ? [home] : [url.href, home];
}

/**
 * Looks at one stored page and, when it differs, the site's home page. robots.txt must allow each page; the page (after at most
 * three checked redirects) must show our badge and link to our site, either by wrapping the badge image in a link to our site or by
 * having a link to our site elsewhere on the page. The first page that does is the one reported. Anything else, including an error,
 * is a failed check; no error text leaves this function.
 */
export async function checkSighting(row: Sighting, siteHost: string, get: FetchPage, robots: Robots, log: (code: string) => void): Promise<CheckFinding> {
  const failed: CheckFinding = { outcome: 'failed', title: null, foundUrl: null };
  const url = parsePublicHttpsUrl(row.url);
  if (!url) return failed;
  for (const target of pagesOf(url)) {
    try {
      const where = new URL(target);
      const txt = await robots(where.hostname);
      if (txt !== null && !robotsAllows(txt, `${where.pathname}${where.search}`)) {
        log('robots');
        continue;
      }
      const page = await get(target);
      // A redirect to another site (http to https and www to bare are fine) says nothing about this one.
      if (bareHost(new URL(page.url).hostname) !== bareHost(url.hostname)) {
        log('elsewhere');
        continue;
      }
      if (page.status < 200 || page.status >= 300 || !/html/i.test(page.contentType ?? '')) {
        log('status');
        continue;
      }
      const scan = scanForBadge(page.body, page.url, siteHost);
      if (scan.badge && scan.link) return { outcome: 'verified', title: scan.title, foundUrl: target };
      log('no-badge');
    } catch (e) {
      log(codeOf(e));
    }
  }
  return failed;
}

/** A check that takes longer than SITE_CHECK_MS in all counts as failed. */
function withinCap(check: Promise<CheckFinding>, log: (code: string) => void, ms: number): Promise<CheckFinding> {
  let timer: ReturnType<typeof setTimeout>;
  const late = new Promise<CheckFinding>((resolve) => {
    timer = setTimeout(() => {
      log('timeout');
      resolve({ outcome: 'failed', title: null, foundUrl: null });
    }, ms);
  });
  return Promise.race([check, late]).finally(() => clearTimeout(timer));
}

/** Checks one row and records the result. False when the result could not be recorded. */
async function checkAndRecord(row: Sighting, ctx: CheckContext, robots: Robots): Promise<CheckOutcome | null> {
  const log = ctx.log ?? defaultLog;
  const get = ctx.fetchPage ?? fetchPageFor(ctx.siteHost);
  const found = await withinCap(checkSighting(row, ctx.siteHost, get, robots, log), log, ctx.siteCheckMs ?? SITE_CHECK_MS);
  const checkedAt = ctx.now().toISOString();
  try {
    await ctx.repo.recordCheck(
      row.url,
      found.outcome === 'verified' && found.foundUrl !== null
        ? { checkedAt, consecutiveFailures: 0, verified: { title: found.title, foundUrl: found.foundUrl } }
        : { checkedAt, consecutiveFailures: row.consecutiveFailures + 1, verified: null },
    );
  } catch {
    log('record');
    return null;
  }
  return found.outcome;
}

/**
 * The daily check: the pages not looked at for about a day, never-checked first and then the oldest check, at most 100, five at a
 * time, and no new one after the deadline (each site gets at most SITE_CHECK_MS). Each result is recorded as it comes. A page that fails twice in a row is no longer
 * listed; pages nobody has seen showing the badge for 60 days are deleted (before the checks start). It never throws.
 */
export async function runBadgeChecks(deps: VerifyDeps): Promise<{ checked: number; verified: number }> {
  const log = deps.log ?? defaultLog;
  const stats = { checked: 0, verified: 0 };
  try {
    const now = deps.now();
    // Housekeeping first, on its own, so a slow or failing round of checks never leaves old rows behind.
    try {
      await deps.repo.prune(new Date(now.getTime() - FORGET_AFTER_MS).toISOString());
    } catch {
      log('prune');
    }
    const due = await deps.repo.dueForCheck(new Date(now.getTime() - CHECK_EVERY_MS).toISOString(), deps.sitesPerRun ?? SITES_PER_RUN);
    const robots = robotsLoader(deps.fetchPage ?? fetchPageFor(deps.siteHost));
    const queue = [...due];
    const worker = async (): Promise<void> => {
      for (let row = queue.shift(); row; row = queue.shift()) {
        if (Date.now() > deps.deadline) return;
        const outcome = await checkAndRecord(row, deps, robots);
        if (outcome === null) continue;
        stats.checked++;
        if (outcome === 'verified') stats.verified++;
      }
    };
    await Promise.all(Array.from({ length: Math.min(CHECK_CONCURRENCY, due.length) }, worker));
  } catch {
    log('run');
  }
  return stats;
}

export interface VerifyNowDeps extends CheckContext {
  /** Asks for one of the site-wide immediate checks of the hour; false (or a throw) means it is used up. */
  allow: () => Promise<boolean>;
}

export type VerifyNowOutcome = 'verified' | 'failed' | 'limited' | 'missing' | 'error';

/**
 * Checks one page right after the badge was requested from it, so a new site shows up within minutes. It first asks `allow`, which
 * holds the site-wide hourly limit, so a flood of made-up referrers cannot make the server crawl the web; a page over the limit
 * waits for the daily run. It follows the same rules as the daily run and never throws.
 */
export async function verifyNow(url: string, deps: VerifyNowDeps): Promise<VerifyNowOutcome> {
  try {
    const row = await deps.repo.find(url);
    if (!row) return 'missing';
    if (!(await deps.allow())) return 'limited';
    const outcome = await checkAndRecord(row, deps, robotsLoader(deps.fetchPage ?? fetchPageFor(deps.siteHost)));
    return outcome ?? 'error';
  } catch {
    (deps.log ?? defaultLog)('now');
    return 'error';
  }
}
