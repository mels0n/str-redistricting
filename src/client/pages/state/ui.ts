import {
  h,
  clear,
  announce,
  describeError,
  describeRouteIssue,
  fitRouteToState,
  formatHash,
  formatInt,
  formatPeople,
  getLocated,
  setLocated,
  peopleNoun,
  prefersReducedMotion,
  iconArrowDown,
  iconArrowLeft,
  stateRoute,
  NATIONAL,
  MapUnavailableError,
  UnknownStateError,
  type Navigate,
  type Page,
  type StateRoute,
  type LonLat,
} from '../../shared';
import { loadIndex, loadOutlines, findState, isGenerated, type GeneratedState } from '../../entities/state';
import { loadStateBundle, loadEnacted, districtAt, type StateBundle, type EnactedShapes } from '../../entities/plan';
import { createAddressSearch, describeResolution, resolveAddress } from '../../features/address-search';
import { createCutScrubber, type CutScrubber } from '../../features/cut-scrubber';
import { createPlanOptions, type PlanOptions } from '../../features/plan-options';
import { createDistrictMap, type DistrictMapView } from '../../widgets/district-map';
import { createDistrictTicket } from '../../widgets/district-ticket';
import { createDistrictList } from '../../widgets/district-list';
import { createProofPanel } from '../../widgets/proof-panel';
import { createExplainer } from '../../widgets/explainer';

export function createStatePage(initial: StateRoute, nav: Navigate): Page {
  let route = initial;
  let alive = true;
  let hovered: number | null = null;
  let animateNext = false;
  let enacted: EnactedShapes | null = null;
  let enactedFailed = false;
  let enactedLoading = false;
  let seats: number | null = null;
  let stateName = initial.abbr;
  /** The corrected link a notice explains; the notice stays while the route is still that one. */
  let noticeHash: string | null = null;
  let located: { district: number | null; lonLat: LonLat; matchedAddress: string } | null = null;

  const h1 = h('h1', { class: 'strv-state__h1', tabindex: -1 }, initial.abbr);
  const back = h('a', { href: formatHash(NATIONAL), class: 'strv-back' }, iconArrowLeft(), 'All states');
  const meta = h('dl', { class: 'strv-state__meta' });
  const head = h('header', { class: 'strv-state__head' }, back, h1, meta);

  // Spoken through announce(); a hidden element cannot be a live region.
  const notice = h('p', { class: 'strv-notice', hidden: true });
  const mapEl = h('div', { class: 'strv-state__map', role: 'region', 'aria-label': 'District map', 'aria-busy': 'true' });
  const legend = h('div', { class: 'strv-legend', 'aria-hidden': 'true' });
  const mapFrame = h('div', { class: 'strv-state__frame' }, mapEl);
  // Phones: the chosen district's headline sits right under the map, so a tap on the map is answered without scrolling.
  const pick = h('div', { class: 'strv-pick' });
  const stage = h('div', { class: 'strv-state__stage' }, mapFrame, legend, pick);
  const panel = h('div', { class: 'strv-state__panel' }, head, notice);
  const el = h('main', { class: 'strv-state', id: 'strv-main', 'data-cut-mode': 'false' }, panel, stage);

  metaPlaceholder();
  let map: DistrictMapView | null = null;
  let scrubber: CutScrubber | null = null;
  let options: PlanOptions | null = null;
  let render: (light?: boolean) => void = () => undefined;

  const go = (patch: Partial<StateRoute>, replace = false): void => {
    // Keep our own copy current: replacing navigations are applied a frame later, and the next call must build on this one.
    route = { ...route, ...patch };
    nav(route, { replace });
  };

  function setNotice(text: string | null): void {
    notice.hidden = text === null;
    notice.textContent = text ?? '';
    if (text) announce(text);
  }

  /** Fits the route to this state. A link that asks for something it does not have is corrected and explained. */
  function fitRoute(next: StateRoute): StateRoute {
    if (seats === null) return next;
    const fit = fitRouteToState(next, seats);
    if (fit.issues.length === 0) return fit.route;
    setNotice(fit.issues.map((i) => describeRouteIssue(i, stateName)).join(' '));
    noticeHash = formatHash(fit.route);
    // Make the address bar match what is shown.
    nav(fit.route, { replace: true });
    return fit.route;
  }

  function showError(err: unknown, opts: { retry?: () => void; link?: boolean } = {}): void {
    clear(mapEl);
    mapEl.removeAttribute('aria-busy');
    el.dataset.empty = 'true';
    mapEl.append(
      h(
        'div',
        { class: 'strv-error', role: 'alert' },
        h('p', null, describeError(err)),
        opts.retry ? h('button', { type: 'button', class: 'strv-button', onclick: opts.retry }, 'Try again') : null,
        opts.link ? h('p', null, h('a', { href: formatHash(NATIONAL) }, 'Choose a state')) : null,
      ),
    );
  }

  /** No WebGL, or the map code did not load: the list, tickets and numbers still work without the map. */
  function showMapUnavailable(err: MapUnavailableError): void {
    mapEl.removeAttribute('aria-busy');
    el.dataset.nomap = 'true';
    clear(mapEl);
    mapEl.append(
      h(
        'div',
        { class: 'strv-error strv-error--map', role: 'status' },
        h('p', null, describeError(err)),
        err.kind === 'load' ? h('button', { type: 'button', class: 'strv-button', onclick: () => location.reload() }, 'Reload the page') : null,
      ),
    );
  }

  function showNotGenerated(name: string): void {
    h1.textContent = name;
    document.title = `${name}: map not generated`;
    el.dataset.empty = 'true';
    clear(mapEl);
    mapEl.removeAttribute('aria-busy');
    mapEl.append(
      h(
        'div',
        { class: 'strv-empty' },
        h('p', { class: 'strv-empty__big' }, `The map for ${name} has not been generated.`),
        h('p', null, h('a', { href: formatHash(NATIONAL) }, 'Choose another state')),
      ),
    );
  }

  /** Empty slots with the same shape as the real row, so the header does not change height when the numbers arrive. */
  function metaPlaceholder(): void {
    meta.setAttribute('aria-hidden', 'true');
    for (const k of ['Districts', 'People', 'Ideal district', 'Range']) {
      meta.append(h('div', null, h('dt', null, k), h('dd', null, ' ')));
    }
  }

  function setMeta(state: GeneratedState): void {
    meta.removeAttribute('aria-hidden');
    clear(meta);
    const s = state.summary;
    const item = (k: string, v: string): HTMLElement => h('div', null, h('dt', null, k), h('dd', null, v));
    meta.append(
      item('Districts', String(state.seats)),
      item('People', formatInt(s.population)),
      item('Ideal district', formatPeople(s.ideal)),
      item('Range', `${formatPeople(s.rangePersons)} ${peopleNoun(s.rangePersons)}`),
    );
  }

  async function start(retried = false): Promise<void> {
    const retry = (): void => void start(true);
    mapEl.setAttribute('aria-busy', 'true');
    delete el.dataset.empty;
    clear(mapEl);
    const loading = h('p', { class: 'strv-loading', tabindex: -1 }, 'Loading the map…');
    mapEl.append(loading);
    // The Try again button the visitor just used is gone; keep focus on the page.
    if (retried) loading.focus({ preventScroll: true });
    let index;
    try {
      index = await loadIndex();
    } catch (err) {
      if (alive) showError(err, { retry });
      return;
    }
    if (!alive) return;
    const entry = findState(index, route.abbr);
    if (!entry) {
      h1.textContent = 'State not found';
      document.title = 'State not found';
      showError(new UnknownStateError(route.abbr), { link: true });
      return;
    }
    stateName = entry.name;
    if (!isGenerated(entry)) {
      showNotGenerated(entry.name);
      return;
    }
    h1.textContent = entry.name;
    mapEl.setAttribute('aria-label', `Map of ${entry.name}’s ${entry.seats} districts. Every district is also listed in the Districts table.`);
    setMeta(entry);
    document.title = `${entry.name}: ${entry.seats} districts drawn by rule`;
    clear(mapEl);
    const loadingState = h('p', { class: 'strv-loading', tabindex: -1 }, `Loading the map of ${entry.name}…`);
    mapEl.append(loadingState);
    if (retried) loadingState.focus({ preventScroll: true });

    let bundle: StateBundle;
    let outlines;
    try {
      [bundle, outlines] = await Promise.all([loadStateBundle(entry.abbr), loadOutlines()]);
    } catch (err) {
      if (alive) showError(err, { retry });
      return;
    }
    if (!alive) return;
    try {
      build(entry, bundle, index);
    } catch (err) {
      showError(err, { retry });
      return;
    }
    clear(mapEl);
    try {
      map = await createDistrictMap({
        container: mapEl,
        bundle,
        outlines,
        stateName: entry.name,
        onSelect: (d) => {
          if (d !== route.district) go({ district: d });
        },
        onHover: (d) => {
          hovered = d;
          render(true);
        },
      });
    } catch (err) {
      if (!alive) return;
      if (err instanceof MapUnavailableError) {
        showMapUnavailable(err);
        render();
      } else {
        showError(err, { retry });
      }
      return;
    }
    if (!alive) {
      map.destroy();
      return;
    }
    mapEl.removeAttribute('aria-busy');
    render();
  }

  function build(entry: GeneratedState, bundle: StateBundle, index: Awaited<ReturnType<typeof loadIndex>>): void {
    const total = bundle.cuts.length;
    seats = entry.seats;
    route = fitRoute(route);
    const ticket = createDistrictTicket();
    const list = createDistrictList({ onSelect: (d) => go({ district: d === route.district ? null : d }) });
    const proof = createProofPanel();
    options = createPlanOptions({
      enactedSource: bundle.stats.enactedSource,
      onPlan: (plan) => go({ plan }),
      onEnacted: (on) => go({ enacted: on }),
    });
    scrubber = createCutScrubber({
      cuts: bundle.cuts,
      seats: entry.seats,
      onStep: (k, { animate }) => {
        animateNext = animate;
        go({ cut: k }, route.cut !== null);
      },
      onFinish: () => go({ cut: null }),
    });
    const search = createAddressSearch({
      id: 'strv-address-state',
      label: 'Find a district by address',
      onFound(result) {
        const where = resolveAddress(index, result, entry.abbr);
        if (where.kind !== 'here') {
          if (where.kind === 'open') {
            setLocated({ state: where.state.abbr, lonLat: result.lonLat, matchedAddress: result.matchedAddress });
            nav(stateRoute(where.state.abbr));
          }
          return describeResolution(where, result);
        }
        setLocated({ state: entry.abbr, lonLat: result.lonLat, matchedAddress: result.matchedAddress });
        locate(bundle);
        if (located?.district === null) return `${result.matchedAddress} falls just outside the simplified district shapes. It is in ${entry.name}; check the district list near that spot.`;
        go({ district: located!.district });
        return `${result.matchedAddress} is in District ${located!.district}.`;
      },
    });
    const locatedNote = h('p', { class: 'strv-located', hidden: true });

    stage.append(scrubber.el);
    const ticketBox = h('div', { class: 'strv-state__ticket' }, ticket.el, locatedNote);
    let pickKey = '';
    const renderPick = (plan: string, d: { district: number; pop: number } | null, color: string | null): void => {
      const key = `${plan}|${d?.district ?? ''}`;
      if (key === pickKey) return;
      pickKey = key;
      clear(pick);
      if (!d) {
        pick.append(h('p', { class: 'strv-pick__hint' }, 'Tap a district on the map to see its numbers.'));
        return;
      }
      pick.append(
        h(
          'button',
          {
            type: 'button',
            class: 'strv-pick__btn',
            onclick: () => ticketBox.scrollIntoView({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' }),
          },
          h('span', { class: 'strv-pick__swatch', style: `background:${color ?? 'transparent'}`, 'aria-hidden': 'true' }),
          h('span', { class: 'strv-pick__text' }, h('strong', null, `District ${d.district}`), ` ${formatInt(d.pop)} people`),
          h('span', { class: 'strv-pick__more' }, 'Full ticket', iconArrowDown()),
        ),
      );
    };
    panel.append(
      ticketBox,
      h('div', { class: 'strv-state__search' }, search.el),
      h('div', { class: 'strv-state__options' }, options.el),
      h('div', { class: 'strv-state__list' }, list.el),
      h('div', { class: 'strv-state__proof' }, proof.el),
      h('div', { class: 'strv-state__explain' }, createExplainer({ seats: entry.seats })),
    );

    locate(bundle);
    if (located?.district && route.district === null) go({ district: located.district }, true);

    // Stepping through the cuts changes neither the list nor the numbers; rebuild them only when their content would change.
    let listKey = '';
    let proofKey = '';

    render = (light = false) => {
      if (!alive) return;
      const cutMode = route.cut !== null;
      const plan = cutMode ? 'before' : route.plan;
      const planStats = plan === 'official' ? bundle.stats.official : bundle.stats.beforeBalancing;
      const selected = route.district !== null && route.district <= entry.seats ? route.district : null;
      const shown = hovered ?? selected;
      const stats = shown !== null ? (planStats.districts.find((d) => d.district === shown) ?? null) : null;

      el.dataset.cutMode = String(cutMode);
      ticket.update({
        district: stats,
        color: shown !== null ? bundle.colors[shown - 1]! : null,
        ideal: planStats.metrics.ideal,
        plan,
        located: located?.district === shown && shown !== null,
        preview: hovered !== null && hovered !== selected,
      });
      const picked = selected !== null ? (planStats.districts.find((d) => d.district === selected) ?? null) : null;
      renderPick(plan, picked, picked ? bundle.colors[picked.district - 1]! : null);
      if (light) {
        map?.set(mapState(selected, cutMode));
        return;
      }
      if (located) {
        locatedNote.hidden = false;
        locatedNote.textContent = located.district
          ? `Your address, ${located.matchedAddress}, is in District ${located.district}. Shapes are simplified for display; close to a border, the block assignment file is the final word.`
          : `Your address, ${located.matchedAddress}, is marked on the map.`;
      }
      const nextListKey = `${plan}|${selected}|${located?.district ?? ''}`;
      if (nextListKey !== listKey) {
        listKey = nextListKey;
        list.update({
          districts: planStats.districts,
          colors: bundle.colors,
          selected,
          located: located?.district ?? null,
          caption: `${entry.name}, ${entry.seats} districts, ${plan === 'official' ? 'official map' : 'before balancing'}. Ideal district: ${formatPeople(planStats.metrics.ideal)} people.`,
        });
      }
      if (plan !== proofKey) {
        proofKey = plan;
        proof.update({ metrics: planStats.metrics, plan, abbr: entry.abbr });
      }
      options!.update({ plan: route.plan, enacted: route.enacted, cutMode, enactedFailed });
      scrubber!.update(route.cut === null ? null : Math.min(route.cut, total));

      clear(legend);
      const legendItems: (HTMLElement | null)[] = [
        h('span', { class: 'strv-legend__item' }, h('span', { class: 'strv-legend__num' }, '3'), 'District number'),
        cutMode ? h('span', { class: 'strv-legend__item' }, h('span', { class: 'strv-legend__cut' }), 'Newest cut') : null,
        cutMode ? h('span', { class: 'strv-legend__item' }, h('span', { class: 'strv-legend__past' }), 'Earlier cuts') : null,
        route.enacted ? h('span', { class: 'strv-legend__item' }, h('span', { class: 'strv-legend__dash' }), 'Today’s districts') : null,
      ];
      legend.append(...legendItems.filter((x): x is HTMLElement => x !== null));

      if (!route.enacted) enactedFailed = false;
      else if (!enacted && !enactedFailed && !enactedLoading) {
        // One attempt at a time; after a failure the visitor unchecks and checks the box to try again.
        enactedLoading = true;
        loadEnacted(entry.abbr)
          .then((e) => {
            enacted = e;
          })
          .catch(() => {
            enactedFailed = true;
          })
          .finally(() => {
            enactedLoading = false;
            render();
          });
      }

      map?.set(mapState(selected, cutMode));
      animateNext = false;
    };
    const mapState = (selected: number | null, cutMode: boolean) => ({
      plan: route.plan,
      cut: cutMode ? Math.min(route.cut!, total) : null,
      selected,
      hovered,
      enacted: route.enacted ? enacted : null,
      located: located?.lonLat ?? null,
      animate: animateNext,
    });
    render();
  }

  function locate(bundle: StateBundle): void {
    const l = getLocated();
    if (!l || l.state !== bundle.abbr) return;
    located = { district: districtAt(bundle.official.features, l.lonLat), lonLat: l.lonLat, matchedAddress: l.matchedAddress };
  }

  void start();

  return {
    el,
    focusTarget: () => h1,
    update(next) {
      if (next.page !== 'state' || next.abbr !== route.abbr) return false;
      route = fitRoute(next);
      // A notice about a bad link goes away once the visitor moves on.
      if (formatHash(route) !== noticeHash) setNotice(null);
      hovered = null;
      render();
      return true;
    },
    destroy() {
      alive = false;
      scrubber?.destroy();
      map?.destroy();
    },
  };
}

