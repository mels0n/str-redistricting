import { h, clear, describeError, setLocated, stateRoute, formatHash, howRoute, type Navigate, type Page } from '../../shared';
import { loadIndex, loadOutlines } from '../../entities/state';
import { createAddressSearch, describeResolution, resolveAddress } from '../../features/address-search';
import { createUsMap, type UsMap } from '../../widgets/us-map';
import { createStateIndex } from '../../widgets/state-index';

export function createNationalPage(nav: Navigate): Page {
  const h1 = h(
    'h1',
    { class: 'strv-national__h1', tabindex: -1 },
    'Voters should pick their politicians.',
    ' ',
    h('span', { class: 'strv-national__h1-line' }, 'Not the other way around.'),
  );
  const step = (title: string, text: string): HTMLElement => h('li', null, h('strong', null, title), ' ', text);
  const lede = h(
    'div',
    { class: 'strv-national__lede' },
    h('p', null, 'People, usually politicians, draw the lines. They see your party, your race, your income, and use that to pick their voters. That is gerrymandering.'),
    h('p', { class: 'strv-national__closing' }, 'So we removed the human. Code draws these maps from census headcounts and block shapes alone. No human, no gerrymandering.'),
    h(
      'div',
      { class: 'strv-national__how' },
      h('h2', { class: 'strv-national__how-h' }, 'Three steps. No humans.'),
      h(
        'ol',
        { class: 'strv-national__steps' },
        step('Cut.', 'Split the state along the shortest line that divides its people by seats. Repeat until each piece is one district.'),
        step('Keep blocks whole.', 'The census counts people in blocks: areas bounded by streets, streams, rail lines and similar edges. There is no count for part of a block, so lines follow block edges.'),
        step('Balance.', 'Blocks along each border shift only when that brings two districts closer to equal population.'),
      ),
      h('p', { class: 'strv-national__scope' }, 'These maps cover the 50 states. Washington, D.C. and the U.S. territories elect non-voting delegates to the House, so they have no districts to draw.'),
    ),
    h('p', { class: 'strv-national__more' }, h('a', { href: formatHash(howRoute()) }, 'How it works: every stage, with drawings')),
  );

  const search = createAddressSearch({
    id: 'strv-address-national',
    onFound(result) {
      // The lookup can outlive the page: a late answer must not move a visitor who has gone elsewhere.
      if (!alive) return undefined;
      // The index has not loaded yet (the data failed or is slow): there is nothing to look the state up in.
      if (!indexCache) return 'The list of states has not loaded yet. Try again once the map appears.';
      const where = resolveAddress(indexCache, result, null);
      if (where.kind === 'here') return undefined;
      if (where.kind === 'open') {
        setLocated({ state: where.state.abbr, lonLat: result.lonLat, matchedAddress: result.matchedAddress, ...(result.block !== null && { block: result.block }) });
        nav(stateRoute(where.state.abbr));
      }
      return describeResolution(where, result);
    },
  });

  const mapSlot = h('div', { class: 'strv-national__map', 'aria-busy': 'true' }, h('p', { class: 'strv-loading' }, 'Loading the map of the states…'));
  const indexSlot = h('div', { class: 'strv-national__index' });

  let usMap: UsMap | null = null;
  let indexCache: Awaited<ReturnType<typeof loadIndex>> | null = null;

  const el = h(
    'main',
    { class: 'strv-national', id: 'strv-main' },
    h(
      'div',
      { class: 'strv-national__grid' },
      h('div', { class: 'strv-national__head' }, h1),
      // On a phone the lede and map are separate rows (lede, map, index, then the address search); on a wide screen they stay pinned together beside the index.
      // Source order follows the phone layout, so on a wide screen the search (shown top left) is reached after the index by Tab; its search landmark is the shortcut.
      h('div', { class: 'strv-national__side' }, lede, mapSlot),
      // On a wide screen the search and index share one left rail, so the index starts right under the search instead of below the headline block.
      h('div', { class: 'strv-national__rail' }, indexSlot, h('div', { class: 'strv-national__search' }, search.el)),
    ),
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
        usMap?.destroy();
        usMap = createUsMap({ outlines, index });
        mapSlot.append(usMap.el);
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
  document.title = 'Fair House Maps: voters pick politicians, not the other way around';

  return {
    el,
    focusTarget: () => h1,
    destroy() {
      alive = false;
      usMap?.destroy();
    },
  };
}
