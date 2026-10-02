import { h, clear, describeError, setLocated, stateRoute, type Navigate, type Page } from '../../shared';
import { loadIndex, loadOutlines } from '../../entities/state';
import { createAddressSearch, describeResolution, resolveAddress } from '../../features/address-search';
import { createUsMap } from '../../widgets/us-map';
import { createStateIndex } from '../../widgets/state-index';
import { createExplainer } from '../../widgets/explainer';

export function createNationalPage(nav: Navigate): Page {
  const h1 = h('h1', { class: 'strv-national__h1', tabindex: -1 }, 'U.S. House districts, each drawn by the same published rule');
  const lede = h(
    'p',
    { class: 'strv-national__lede' },
    'Every map here comes from 2020 Census counts and one fixed rule: split the state along the straight line that gives the shortest border, then split each piece the same way until every piece is one district. No party data, no human choices, and the same map every time anyone runs it.',
  );

  const search = createAddressSearch({
    id: 'strv-address-national',
    onFound(result) {
      // The index has not loaded yet (the data failed or is slow): there is nothing to look the state up in.
      if (!indexCache) return 'The list of states has not loaded yet. Try again once the map appears.';
      const where = resolveAddress(indexCache, result, null);
      if (where.kind === 'here') return undefined;
      if (where.kind === 'open') {
        setLocated({ state: where.state.abbr, lonLat: result.lonLat, matchedAddress: result.matchedAddress });
        nav(stateRoute(where.state.abbr));
      }
      return describeResolution(where, result);
    },
  });

  const mapSlot = h('div', { class: 'strv-national__map', 'aria-busy': 'true' }, h('p', { class: 'strv-loading' }, 'Loading the map of the states…'));
  const indexSlot = h('div', { class: 'strv-national__index' });

  let indexCache: Awaited<ReturnType<typeof loadIndex>> | null = null;

  const el = h(
    'main',
    { class: 'strv-national', id: 'strv-main' },
    h('div', { class: 'strv-national__head' }, h1, lede),
    h('div', { class: 'strv-national__search' }, search.el),
    mapSlot,
    indexSlot,
    h('div', { class: 'strv-national__explain' }, createExplainer()),
  );

  let alive = true;
  const load = (retried = false): void => {
    clear(mapSlot);
    const loading = h('p', { class: 'strv-loading', tabindex: -1 }, 'Loading the map of the states…');
    mapSlot.append(loading);
    mapSlot.setAttribute('aria-busy', 'true');
    // The Try again button the visitor just used is gone; keep focus on the page.
    if (retried) loading.focus({ preventScroll: true });
    Promise.all([loadIndex(), loadOutlines()])
      .then(([index, outlines]) => {
        if (!alive) return;
        indexCache = index;
        clear(mapSlot);
        mapSlot.removeAttribute('aria-busy');
        mapSlot.append(createUsMap({ outlines, index }));
        clear(indexSlot);
        indexSlot.append(createStateIndex(index));
      })
      .catch((err: unknown) => {
        if (!alive) return;
        clear(mapSlot);
        mapSlot.removeAttribute('aria-busy');
        mapSlot.append(
          h('div', { class: 'strv-error', role: 'alert' }, h('p', null, describeError(err)), h('button', { type: 'button', class: 'strv-button', onclick: () => load(true) }, 'Try again')),
        );
      });
  };
  load();
  document.title = 'House districts drawn by rule';

  return {
    el,
    focusTarget: () => h1,
    destroy() {
      alive = false;
    },
  };
}
