import type { BadgeRepo, Sighting } from '../../entities/badge-db/index.js';
import { fetchPublic, parsePublicHttpsUrl, SsrfError, type FetchedPage } from '../../shared/ssrf/index.js';
import { scanForBadge } from './html.js';
import { CHECKER_NAME, robotsAllows } from './robots.js';

export const CHECKER_USER_AGENT = `${CHECKER_NAME} (+https://fairmaps.melson.us/pledges)`;
export const SITES_PER_RUN = 25;
export const CHECK_EVERY_MS = 20 * 3_600_000;
export const FORGET_AFTER_MS = 60 * 86_400_000;
const WORKERS = 5;

export type FetchPage = (url: string, accept?: string) => Promise<FetchedPage>;

/** The real fetch: public https sites only, 5 seconds, 1 MB, three redirects, each hop checked. */
export const fetchPage: FetchPage = (url, accept) => fetchPublic(url, { userAgent: CHECKER_USER_AGENT, timeoutMs: 5000, maxBytes: 1_048_576, maxRedirects: 3, ...(accept ? { accept } : {}) });

export interface VerifyDeps {
  repo: BadgeRepo;
  /** Our own host, the one a page must show the badge from and link to. */
  siteHost: string;
  now: () => Date;
  fetchPage?: FetchPage;
  /** Epoch milliseconds after which no new site is started. */
  deadline: number;
  /** Logs a code only: never an address, a header or a body. */
  log?: (code: string) => void;
  sitesPerRun?: number;
}

export type CheckOutcome = 'verified' | 'failed';

const codeOf = (e: unknown): string => (e instanceof SsrfError ? e.code : 'error');

/** The text of a site's robots.txt, or null when it has none we can read (which allows the check). One fetch per host per run. */
function robotsLoader(get: FetchPage): (host: string) => Promise<string | null> {
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

/**
 * Looks at one stored page: robots.txt must allow it, and the page (after at most three checked redirects) must show our badge and
 * link to our site. Anything else, including an error, is a failed check; no error text leaves this function.
 */
export async function checkSighting(row: Sighting, siteHost: string, get: FetchPage, robots: (host: string) => Promise<string | null>, log: (code: string) => void): Promise<{ outcome: CheckOutcome; title: string | null }> {
  const failed = { outcome: 'failed' as const, title: null };
  const url = parsePublicHttpsUrl(row.url);
  if (!url) return failed;
  try {
    const txt = await robots(url.hostname);
    if (txt !== null && !robotsAllows(txt, `${url.pathname}${url.search}`)) {
      log('robots');
      return failed;
    }
    const page = await get(url.href);
    if (page.status < 200 || page.status >= 300 || !/html/i.test(page.contentType ?? '')) {
      log('status');
      return failed;
    }
    const scan = scanForBadge(page.body, page.url, siteHost);
    if (!scan.badge || !scan.link) {
      log('no-badge');
      return failed;
    }
    return { outcome: 'verified', title: scan.title };
  } catch (e) {
    log(codeOf(e));
    return failed;
  }
}

/**
 * The daily check: the pages not looked at for about a day, never-checked first and then oldest, at most 25, five at a time, and
 * no new one after the deadline. Each result is recorded as it comes. A page that fails twice in a row is no longer listed; pages
 * nobody has seen showing the badge for 60 days are deleted. It never throws.
 */
export async function runBadgeChecks(deps: VerifyDeps): Promise<{ checked: number; verified: number }> {
  const log = deps.log ?? ((code: string) => console.error(JSON.stringify({ badgeCheck: code })));
  const get = deps.fetchPage ?? fetchPage;
  const stats = { checked: 0, verified: 0 };
  try {
    const now = deps.now();
    const due = await deps.repo.dueForCheck(new Date(now.getTime() - CHECK_EVERY_MS).toISOString(), deps.sitesPerRun ?? SITES_PER_RUN);
    const robots = robotsLoader(get);
    const queue = [...due];
    const worker = async (): Promise<void> => {
      for (let row = queue.shift(); row; row = queue.shift()) {
        if (Date.now() > deps.deadline) return;
        const result = await checkSighting(row, deps.siteHost, get, robots, log);
        const checkedAt = deps.now().toISOString();
        try {
          await deps.repo.recordCheck(
            row.url,
            result.outcome === 'verified' ? { checkedAt, consecutiveFailures: 0, verified: { title: result.title } } : { checkedAt, consecutiveFailures: row.consecutiveFailures + 1, verified: null },
          );
        } catch {
          log('record');
          continue;
        }
        stats.checked++;
        if (result.outcome === 'verified') stats.verified++;
      }
    };
    await Promise.all(Array.from({ length: Math.min(WORKERS, due.length) }, worker));
    await deps.repo.prune(new Date(now.getTime() - FORGET_AFTER_MS).toISOString());
  } catch {
    log('run');
  }
  return stats;
}
