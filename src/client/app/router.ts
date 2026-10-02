import { clear, formatHash, parseHash, type Page, type Route } from '../shared';
import { createNationalPage } from '../pages/national';
import { createStatePage } from '../pages/state';

/**
 * Hash router. A route for the page already showing is handed to that page
 * (so the state map is not rebuilt when a district is selected); any other
 * route replaces the page and moves focus to its heading.
 *
 * Replacing navigations (the cut scrubber) are applied once per animation
 * frame, so dragging the scrubber fast does the map work for the latest cut
 * only and never floods the History API.
 */
export function startRouter(outlet: HTMLElement): void {
  let page: Page | null = null;
  let initial = true;
  let pending: Route | null = null;
  let frame: number | null = null;

  /** Rewrites the address bar without adding history. Some browsers throttle this call or forbid it in a sandboxed frame; the page still works without it. */
  const replaceHash = (hash: string): void => {
    try {
      history.replaceState(history.state, '', hash);
    } catch {
      /* the address bar is stale, the view is right */
    }
  };

  const flush = (): void => {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    if (!pending) return;
    const route = pending;
    pending = null;
    replaceHash(formatHash(route));
    show(route);
  };

  const navigate = (route: Route, opts: { replace?: boolean } = {}): void => {
    if (opts.replace) {
      pending = route;
      frame ??= requestAnimationFrame(flush);
      return;
    }
    flush();
    const hash = formatHash(route);
    if (location.hash !== hash) {
      location.hash = hash;
    } else {
      show(route);
    }
  };

  function show(route: Route): void {
    if (page?.update?.(route)) return;
    page?.destroy();
    clear(outlet);
    page = route.page === 'national' ? createNationalPage(navigate) : createStatePage(route, navigate);
    outlet.append(page.el);
    // On the first load the browser owns focus; after that, move it to the new page's heading.
    if (!initial) {
      window.scrollTo(0, 0);
      page.focusTarget()?.focus({ preventScroll: true });
    }
    initial = false;
  }

  window.addEventListener('hashchange', () => {
    // The visitor went somewhere else (back button, edited link): that wins over a scrub step still waiting.
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    pending = null;
    const route = parseHash(location.hash);
    // Keep the address bar canonical (e.g. #/co -> #/CO).
    const canonical = formatHash(route);
    if (location.hash !== canonical && !(location.hash === '' && canonical === '#/')) replaceHash(canonical);
    show(route);
  });

  show(parseHash(location.hash));
}
