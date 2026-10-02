import { clear, formatHash, parseHash, type Page, type Route } from '../shared';
import { createNationalPage } from '../pages/national';
import { createStatePage } from '../pages/state';

/**
 * Hash router. A route for the page already showing is handed to that page
 * (so the state map is not rebuilt when a district is selected); any other
 * route replaces the page and moves focus to its heading.
 */
export function startRouter(outlet: HTMLElement): void {
  let page: Page | null = null;
  let initial = true;

  const navigate = (route: Route, opts: { replace?: boolean } = {}): void => {
    const hash = formatHash(route);
    if (opts.replace) {
      history.replaceState(history.state, '', hash);
      show(route);
    } else if (location.hash !== hash) {
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
    const route = parseHash(location.hash);
    // Keep the address bar canonical (e.g. #/co -> #/CO).
    const canonical = formatHash(route);
    if (location.hash !== canonical && !(location.hash === '' && canonical === '#/')) history.replaceState(history.state, '', canonical);
    show(route);
  });

  show(parseHash(location.hash));
}
