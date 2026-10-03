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
    h('p', null, 'In most states, politicians draw the district lines. Here, nobody does. Every map comes from 2020 Census counts and three fixed steps that anyone can check:'),
    h(
      'ol',
      { class: 'strv-national__steps' },
      step('Cut.', 'Split the state along the shortest line that divides its people evenly between the seats on each side. Repeat until each piece is one district.'),
      step('Keep blocks whole.', 'Census blocks are never split. A stray piece cut off from its side joins the side around it, and the line slides so the count stays even.'),
      step('Balance.', 'Single blocks along a border move to the neighboring district only when that narrows the population gap and both stay connected.'),
    ),
    h('p', { class: 'strv-national__closing' }, 'No party data. No incumbent addresses. The same map every time.'),
    h('p', { class: 'strv-national__more' }, h('a', { href: formatHash(howRoute()) }, 'How it works: every stage, with drawings')),
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
      h('div', { class: 'strv-national__side' }, lede, mapSlot),
      indexSlot,
      h('div', { class: 'strv-national__search' }, search.el),
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
