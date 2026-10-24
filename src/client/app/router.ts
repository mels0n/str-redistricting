import { canonicalPath, clear, config, formatHash, formatPath, getRouteMode, parseHash, parsePath, resetPageZoom, type Chamber, type Page, type Route } from '../shared';
import { loadIndex, liveChambers } from '../entities/state';
import { createNationalPage } from '../pages/national';
import { createStatePage } from '../pages/state';
import { createHowPage } from '../pages/how';
import { createChangelogPage } from '../pages/changelog';
import { createFaqPage } from '../pages/faq';
import { syncChamberSwitch } from '../widgets/site-header';

/** Aborts the listeners of the router started before, so a second start (a test, a re-mount) never leaves two routers answering. */
let previous: AbortController | null = null;

/** Links the router leaves to the browser: data files, built assets, and anything that names a file. */
function isPageLink(url: URL): boolean {
  if (url.pathname.startsWith('/data/') || url.pathname.startsWith('/assets/')) return false;
  return !/\.[A-Za-z0-9]+$/.test(url.pathname);
}

/** Points the canonical link and og:url at the page's indexable address. */
function setCanonical(route: Route): void {
  const href = `https://${config.siteHost}${canonicalPath(route)}`;
  let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'canonical';
    document.head.append(link);
  }
  link.href = href;
  let og = document.head.querySelector<HTMLMetaElement>('meta[property="og:url"]');
  if (!og) {
    og = document.createElement('meta');
    og.setAttribute('property', 'og:url');
    document.head.append(og);
  }
  og.content = href;
}

/**
 * Router. In path mode (the site) routes are real paths and history entries; in hash mode (the viewer embedded in a
 * page that owns the path) they are `#/…` fragments, exactly as before. Old hash links open in either mode.
 *
 * A route for the page already showing is handed to that page
 * (so the state map is not rebuilt when a district is selected); any other
 * route replaces the page and moves focus to its heading.
 *
 * Replacing navigations (the cut scrubber) are applied once per animation
 * frame, so dragging the scrubber fast does the map work for the latest cut
 * only and never floods the History API.
 *
 * Link clicks are taken over only inside `root` (the viewer's element; by default the outlet's parent, which the
 * shell fills), so links elsewhere on a host page are left to the browser.
 */
export function startRouter(outlet: HTMLElement, root: HTMLElement = outlet.parentElement ?? outlet): void {
  previous?.abort();
  previous = new AbortController();
  const { signal } = previous;
  const pathMode = getRouteMode() === 'path';
  let page: Page | null = null;
  let initial = true;
  let pending: Route | null = null;
  let frame: number | null = null;
  let shown: Route | null = null;
  /** The chambers that have maps, once the index is in; until then only the federal House. */
  let live: ReadonlySet<Chamber> | undefined;

  /** Rewrites the address bar without adding history. Some browsers throttle this call or forbid it in a sandboxed frame; the page still works without it. */
  const replaceUrl = (url: string): void => {
    try {
      history.replaceState(history.state, '', url);
    } catch {
      /* the address bar is stale, the view is right */
    }
  };
  const addressOf = (route: Route): string => (pathMode ? formatPath(route) : formatHash(route));

  const flush = (): void => {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    if (!pending) return;
    const route = pending;
    pending = null;
    replaceUrl(addressOf(route));
    show(route);
  };

  const navigate = (route: Route, opts: { replace?: boolean } = {}): void => {
    if (opts.replace) {
      pending = route;
      frame ??= requestAnimationFrame(flush);
      return;
    }
    flush();
    if (pathMode) {
      const path = formatPath(route);
      if (location.pathname + location.search !== path) {
        try {
          history.pushState(null, '', path);
        } catch {
          /* the address bar is stale, the view is right */
        }
      }
      show(route);
      return;
    }
    const hash = formatHash(route);
    if (location.hash !== hash) {
      location.hash = hash;
    } else {
      show(route);
    }
  };

  /** The masthead's How it works and FAQ links say when their page is showing. */
  const markNav = (route: Route): void => {
    const mark = (nav: string, on: boolean): void => {
      const link = document.querySelector(`.strv-masthead [data-nav="${nav}"]`);
      if (on) link?.setAttribute('aria-current', 'page');
      else link?.removeAttribute('aria-current');
    };
    mark('how', route.page === 'how');
    mark('faq', route.page === 'faq');
    syncChamberSwitch(route, live);
  };

  function show(route: Route): void {
    shown = route;
    if (pathMode) setCanonical(route);
    markNav(route);
    if (page?.update?.(route)) return;
    page?.destroy();
    clear(outlet);
    // A pinch-zoom from the last page would otherwise carry over (no reload between pages).
    if (!initial) resetPageZoom();
    page = route.page === 'national' ? createNationalPage(navigate, route.chamber) : route.page === 'how' ? createHowPage(route) : route.page === 'faq' ? createFaqPage(route) : route.page === 'changelog' ? createChangelogPage() : createStatePage(route, navigate);
    outlet.append(page.el);
    // On the first load the browser owns focus; after that, move it to the new page's heading.
    if (!initial) {
      window.scrollTo(0, 0);
      page.focusTarget()?.focus({ preventScroll: true });
    }
    initial = false;
  }

  /** The route the address names: an old `#/…` link wins, else the path. */
  const fromLocation = (): Route => (location.hash.startsWith('#/') ? parseHash(location.hash) : parsePath(location.pathname, location.search));

  /** The visitor went somewhere else (back button, edited link): that wins over a scrub step still waiting. */
  const drop = (): void => {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    pending = null;
  };

  let first: Route;
  if (pathMode) {
    window.addEventListener(
      'popstate',
      () => {
        drop();
        const route = fromLocation();
        // Keep the address bar canonical (e.g. /co -> /CO, an old #/ entry -> its path).
        const path = formatPath(route);
        if (location.pathname + location.search !== path || location.hash !== '') replaceUrl(path);
        show(route);
      },
      { signal },
    );
    document.addEventListener(
      'click',
      (ev) => {
        if (ev.defaultPrevented || ev.button !== 0 || ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.altKey) return;
        const link = (ev.target as Element | null)?.closest?.('a[href]');
        // The home map's state links are SVG <a> elements, whose .href is an SVGAnimatedString: read the attribute instead.
        if (!link || !root.contains(link)) return;
        const isAnchor = link instanceof HTMLAnchorElement || (link?.namespaceURI === 'http://www.w3.org/2000/svg' && link.localName === 'a');
        if (!link || !isAnchor || link.hasAttribute('target') || link.hasAttribute('download')) return;
        const raw = link.getAttribute('href') ?? '';
        if (raw.startsWith('#')) {
          // <base href="/"> makes a bare fragment resolve to the home page, so it is never left to the browser.
          ev.preventDefault();
          if (raw.startsWith('#/')) navigate(parseHash(raw));
          else document.getElementById(decodeURIComponent(raw.slice(1)))?.scrollIntoView();
          return;
        }
        const url = new URL(raw, document.baseURI);
        if (url.origin !== location.origin || !isPageLink(url)) return;
        ev.preventDefault();
        navigate(parsePath(url.pathname, url.search));
      },
      { signal },
    );
    first = fromLocation();
    // An old hash link or a loose path (/co, ?plan=official) is rewritten to its canonical form, as later navigations are.
    const firstPath = formatPath(first);
    if (location.pathname + location.search !== firstPath || location.hash !== '') replaceUrl(firstPath);
  } else {
    window.addEventListener(
      'hashchange',
      () => {
        drop();
        const route = parseHash(location.hash);
        // Keep the address bar canonical (e.g. #/co -> #/CO).
        const canonical = formatHash(route);
        if (location.hash !== canonical && !(location.hash === '' && canonical === '#/')) replaceUrl(canonical);
        show(route);
      },
      { signal },
    );
    first = parseHash(location.hash);
    // An older or loose link (#/co, ?plan=official) is rewritten to its canonical form, as later navigations are.
    const firstHash = formatHash(first);
    if (location.hash !== '' && location.hash !== firstHash) replaceUrl(firstHash);
  }
  show(first);
  // The header can only offer a chamber once the index says it has maps. A failed load leaves the federal House alone.
  loadIndex()
    .then((index) => {
      live = liveChambers(index);
      if (shown) syncChamberSwitch(shown, live);
    })
    .catch(() => undefined);
}
