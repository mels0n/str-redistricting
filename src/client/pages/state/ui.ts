import {
  h,
  clear,
  announce,
  describeError,
  describeRouteIssue,
  fitRouteToState,
  formatHash,
  formatInt,
  congressName,
  districtCount,
  toStateFrame,
  formatPeople,
  getLocated,
  setLocated,
  peopleNoun,
  prefersReducedMotion,
  iconArrowDown,
  iconArrowLeft,
  iconChevronDown,
  createSplitter,
  stateRoute,
  howRoute,
  NATIONAL,
  MapUnavailableError,
  UnknownStateError,
  type Navigate,
  type Page,
  type StateRoute,
  type LonLat,
} from '../../shared';
import { loadIndex, loadOutlines, findState, isGenerated, type GeneratedState } from '../../entities/state';
import {
  loadStateBundle,
  loadEnacted,
  loadBalance,
  loadBlocks,
  populationsAfter,
  balancePlanAt,
  isPartway,
  evenSizes,
  evenSplitSentence,
  type PlanDistricts,
  type StateBundle,
  type EnactedShapes,
  type DistrictStats,
  type SeqPos,
  type Blocks,
} from '../../entities/plan';
import { afterArrivalLoad, finishWhenLoaded, lookupDistricts } from './lookup';
import { createAddressSearch, describeResolution, resolveAddress } from '../../features/address-search';
import { createCutScrubber, type CutScrubber, type BalanceLogState } from '../../features/cut-scrubber';
import { createPlanOptions, type PlanOptions } from '../../features/plan-options';
import { createDistrictMap, type DistrictMapView } from '../../widgets/district-map';
import { createDistrictTicket } from '../../widgets/district-ticket';
import { createDistrictList } from '../../widgets/district-list';
import { createProofPanel } from '../../widgets/proof-panel';
import { createExplainer } from '../../widgets/explainer';
import { createProcessPanel } from '../../widgets/process-panel';

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
  /** The plan on screen: the cut sequence and the balancing replay start from the plan before balancing; the replay's last move is the finished map. */
  const shownPlan = (): 'finished' | 'before' => {
    if (route.move !== null) return balancePlanAt(route.move, moveCount ?? 0);
    return route.cut !== null ? 'before' : route.plan;
  };
  /** The number of balancing moves, once the state's numbers are in. */
  let moveCount: number | undefined;
  /** The balancing log: fetched only when the replay opens. */
  let balance: BalanceLogState = { status: 'idle' };
  /** The district of the located address under the plan on screen. */
  const locatedDistrict = (plan = shownPlan()): number | null => located?.districts[plan] ?? null;
  /** The corrected link a notice explains; the notice stays while the route is still that one. */
  let noticeHash: string | null = null;
  let located: { districts: PlanDistricts; lonLat: LonLat; matchedAddress: string; exact: boolean } | null = null;
  /** The block assignment file, loaded when an address with a census block is looked up; null if it failed. */
  let blocks: Blocks | null = null;

  const h1 = h('h1', { class: 'strv-state__h1', tabindex: -1 }, initial.abbr);
  const back = h('a', { href: formatHash(NATIONAL), class: 'strv-back' }, iconArrowLeft(), 'All states');
  const howLink = h('a', { href: formatHash(howRoute()), class: 'strv-back strv-state__how' }, 'How it works');
  const meta = h('dl', { class: 'strv-state__meta' });
  const head = h('header', { class: 'strv-state__head' }, h('div', { class: 'strv-state__links' }, back, howLink), h1, meta);

  // Spoken through announce(); a hidden element cannot be a live region.
  const notice = h('p', { class: 'strv-notice', hidden: true });
  const mapEl = h('div', { class: 'strv-state__map', role: 'region', 'aria-label': 'District map', 'aria-busy': 'true' });
  // The key is a small block that folds to its title when the map frame is short, so it never takes the state's room.
  const legendList = h('div', { class: 'strv-legend__list', id: 'strv-legend-list' });
  const legendToggle = h('button', { type: 'button', class: 'strv-legend__toggle', 'aria-controls': 'strv-legend-list', 'aria-expanded': 'true' }, h('span', { class: 'strv-legend__title' }, 'Key'), iconChevronDown());
  const legend = h('div', { class: 'strv-legend', 'data-folded': 'false' }, legendToggle, legendList);
  let keyChosen = false;
  const foldKey = (folded: boolean): void => {
    legend.dataset.folded = String(folded);
    legendToggle.setAttribute('aria-expanded', String(!folded));
  };
  legendToggle.addEventListener('click', () => {
    keyChosen = true;
    foldKey(legend.dataset.folded !== 'true');
  });
  // The key lives inside the map frame, so it can never lie across the controls beneath the map.
  const mapFrame = h('div', { class: 'strv-state__frame' }, mapEl, legend);
  // Until the visitor chooses, the key follows the frame: open when there is room, folded when the frame is short.
  const frameWatch = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
    if (!keyChosen && mapFrame.clientHeight > 0) foldKey(mapFrame.clientHeight < 540);
  }) : null;
  frameWatch?.observe(mapFrame);
  // Phones: the chosen district's headline sits right under the map, so a tap on the map is answered without scrolling.
  const pick = h('div', { class: 'strv-pick' });
  const stage = h('div', { class: 'strv-state__stage' }, mapFrame, pick);
  const panel = h('div', { class: 'strv-state__panel' }, head, notice);
  const el = h('main', { class: 'strv-state', id: 'strv-main', 'data-cut-mode': 'false' }, panel, stage);

  // Desktop only (the splitters are hidden below 64rem): drag, or use the arrow keys, to give the map more room.
  let controls: HTMLElement | null = null;
  const placeColSplit = (): void => {
    colSplit.el.style.left = `${panel.getBoundingClientRect().right - el.getBoundingClientRect().left - 6}px`;
  };
  const colSplit = createSplitter({
    orientation: 'vertical',
    label: 'Resize the left column',
    storageKey: 'strv.split.col',
    size: () => panel.getBoundingClientRect().width,
    min: () => 340,
    max: () => el.clientWidth * 0.5,
    apply: (px) => (px === null ? el.style.removeProperty('--col-w') : el.style.setProperty('--col-w', `${px}px`)),
    onChange: placeColSplit,
  });
  const rowSplit = createSplitter({
    orientation: 'horizontal',
    label: 'Resize the map and the cut controls',
    storageKey: 'strv.split.frame',
    size: () => mapFrame.getBoundingClientRect().height,
    // The panel never grows past its own content: no empty band under it, the map takes the rest.
    min: () => Math.max(240, stage.clientHeight - (controls?.offsetHeight ?? 0)),
    // The controls under the map never shrink below their top rows.
    max: () => stage.clientHeight - 232,
    apply: (px) => {
      if (px === null) {
        delete el.dataset.framed;
        el.style.removeProperty('--frame-h');
      } else {
        el.dataset.framed = 'true';
        el.style.setProperty('--frame-h', `${px}px`);
      }
    },
  });
  mapFrame.after(rowSplit.el);
  el.append(colSplit.el);
  colSplit.restore();
  rowSplit.restore();
  const splitWatch =
    typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => {
          placeColSplit();
          colSplit.refresh();
          rowSplit.refresh();
        })
      : null;
  splitWatch?.observe(el);
  splitWatch?.observe(panel);

  metaPlaceholder();
  let map: DistrictMapView | null = null;
  let scrubber: CutScrubber | null = null;
  /** The panel and the scrubber are built once; a retry after a failed map mount only redoes the map. */
  let built = false;
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
    const fit = fitRouteToState(next, seats, moveCount);
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
    for (const k of ['Districts', 'People', 'Even split', 'Range']) {
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
      item('Even split', `${evenSizes(s.population, state.seats)} people`),
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
    mapEl.setAttribute('aria-label', `Map of ${entry.name}’s ${districtCount(entry.seats)}. Every district is also listed in the Districts table.`);
    setMeta(entry);
    document.title = `${entry.name}: ${districtCount(entry.seats)} | Fair House Maps`;
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
    if (!built) {
      try {
        build(entry, bundle, index);
        built = true;
      } catch (err) {
        unbuild();
        showError(err, { retry });
        return;
      }
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

  /** Removes what a build that threw partway added, so a retry starts clean. */
  function unbuild(): void {
    if (scrubber) {
      splitWatch?.unobserve(scrubber.el);
      scrubber.destroy();
      scrubber.el.remove();
      scrubber = null;
    }
    controls = null;
    // The panel starts with the header and the notice; everything after them came from build.
    while (panel.children.length > 2) panel.lastElementChild?.remove();
  }

  function build(entry: GeneratedState, bundle: StateBundle, index: Awaited<ReturnType<typeof loadIndex>>): void {
    const total = bundle.cuts.length;
    const finishedMetrics = bundle.stats.finished.metrics;
    seats = entry.seats;
    moveCount = finishedMetrics.balanceMoves;
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
      moves: finishedMetrics.balanceMoves,
      peopleMoved: finishedMetrics.peopleMovedByBalancing,
      rangeBefore: finishedMetrics.rangeBeforeBalancing,
      onStep: (pos, { animate }) => {
        animateNext = animate;
        const open = route.cut !== null || route.move !== null;
        go(pos.phase === 'cut' ? { cut: pos.k, move: null } : { cut: null, move: pos.m }, open);
      },
      onFinish: () => go({ cut: null, move: null }),
      onZoomToMove: () => map?.zoomToMove(),
    });
    const sequence = scrubber;
    /** Fetches the balancing log the first time the replay opens (and again after a failure, on request). */
    const needBalance = (): void => {
      if (balance.status !== 'idle') return;
      balance = { status: 'loading' };
      loadBalance(entry.abbr, bundle.stats)
        .then((log) => {
          balance = { status: 'ready', log };
        })
        .catch((err: unknown) => {
          balance = {
            status: 'error',
            message: describeError(err),
            retry: () => {
              balance = { status: 'idle' };
              render();
            },
          };
        })
        .finally(() => {
          if (alive) render();
        });
    };
    const search = createAddressSearch({
      id: 'strv-address-state',
      label: 'Find a district by address',
      onFound(result) {
        // The lookup can outlive the page: a late answer must not move a visitor who has gone elsewhere.
        if (!alive) return undefined;
        const where = resolveAddress(index, result, entry.abbr);
        if (where.kind !== 'here') {
          if (where.kind === 'open') {
            setLocated({ state: where.state.abbr, lonLat: result.lonLat, matchedAddress: result.matchedAddress, ...(result.block !== null && { block: result.block }) });
            nav(stateRoute(where.state.abbr));
          }
          return describeResolution(where, result);
        }
        setLocated({ state: entry.abbr, lonLat: result.lonLat, matchedAddress: result.matchedAddress, ...(result.block !== null && { block: result.block }) });
        const finish = (): string => {
          locate(bundle);
          const here = locatedDistrict();
          if (here === null) {
            // No district to select, so nothing else redraws: draw the pin and the note now.
            render();
            return `${result.matchedAddress} falls just outside the simplified district shapes. It is in ${entry.name}; check the district list near that spot.`;
          }
          go({ district: here });
          return `${result.matchedAddress} is in District ${here}.`;
        };
        if (result.block === null || blocks) return finish();
        return finishWhenLoaded(loadBlocks(entry.abbr), {
          alive: () => alive,
          setBlocks: (b) => {
            blocks = b;
          },
          finish,
          fallback: `Found ${result.matchedAddress}.`,
        });
      },
    });
    const locatedNote = h('p', { class: 'strv-located', hidden: true });

    stage.append(scrubber.el);
    controls = scrubber.el;
    splitWatch?.observe(scrubber.el);
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
      h(
        'div',
        { class: 'strv-state__process' },
        createProcessPanel({
          stateName: entry.name,
          metrics: finishedMetrics,
          onWatch: (part) => {
            sequence.start(part);
            // On a phone the panel is far below the map; bring the map and its controls up.
            const top = stage.getBoundingClientRect().top;
            if (top < 0 || top > window.innerHeight * 0.5) stage.scrollIntoView({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
          },
        }),
      ),
      h('div', { class: 'strv-state__proof' }, proof.el),
      h('div', { class: 'strv-state__explain' }, createExplainer({ seats: entry.seats })),
    );

    locate(bundle);
    // The exact answer arrives after the first draw; a failed load keeps the simplified-shape answer.
    if (getLocated()?.state === entry.abbr && getLocated()?.block && !blocks) {
      const shapeAnswer = locatedDistrict();
      // Near a border the exact district differs from the shape answer already selected; follow it unless the visitor moved on.
      void afterArrivalLoad({
        load: loadBlocks(entry.abbr),
        alive: () => alive,
        setBlocks: (b) => {
          blocks = b;
        },
        relocate: () => {
          locate(bundle);
          return locatedDistrict();
        },
        before: shapeAnswer,
        selected: () => route.district,
      }).then((next) => {
        if (next === 'render') render();
        else if (next !== null) go({ district: next }, true);
      });
    }
    const startAt = locatedDistrict();
    if (startAt && route.district === null) go({ district: startAt }, true);

    // Stepping through the cuts changes neither the list nor the numbers; rebuild them only when their content would change.
    let listKey = '';
    let proofKey = '';

    /** During the balancing replay the districts' populations are live: the populations before balancing plus the moves so far. */
    const liveDistricts = (base: readonly DistrictStats[]): DistrictStats[] => {
      // At the last move the plan on screen is the finished map itself, so its own numbers are shown.
      if (route.move === null || balance.status !== 'ready' || shownPlan() === 'finished') return [...base];
      const log = balance.log;
      const pops = populationsAfter(log.before, log.moves, route.move);
      return base.map((d) => {
        const pop = pops[d.district - 1] ?? d.pop;
        return { ...d, pop };
      });
    };

    render = (light = false) => {
      if (!alive) return;
      const cutMode = route.cut !== null;
      const balanceMode = route.move !== null;
      const seqMode = cutMode || balanceMode;
      if (balanceMode) needBalance();
      const plan = shownPlan();
      const planStats = plan === 'finished' ? bundle.stats.finished : bundle.stats.beforeBalancing;
      const districts = liveDistricts(planStats.districts);
      const partway = route.move !== null && isPartway(route.move, finishedMetrics.balanceMoves);
      const selected = route.district !== null && route.district <= entry.seats ? route.district : null;
      const shown = hovered ?? selected;
      const stats = shown !== null ? (districts.find((d) => d.district === shown) ?? null) : null;

      el.dataset.cutMode = String(seqMode);
      el.dataset.phase = cutMode ? 'cut' : balanceMode ? 'balance' : 'none';
      ticket.update({
        district: stats,
        color: shown !== null ? bundle.colors[shown - 1]! : null,
        total: planStats.metrics.population,
        seats: entry.seats,
        plan,
        located: locatedDistrict(plan) === shown && shown !== null,
        preview: hovered !== null && hovered !== selected,
        stage: partway && balance.status === 'ready' ? `After balancing move ${route.move} of ${finishedMetrics.balanceMoves}.` : undefined,
        partway,
      });
      const picked = selected !== null ? (districts.find((d) => d.district === selected) ?? null) : null;
      renderPick(plan, picked, picked ? bundle.colors[picked.district - 1]! : null);
      if (light) {
        map?.set(mapState(selected));
        return;
      }
      if (located) {
        locatedNote.hidden = false;
        const here = locatedDistrict(plan);
        locatedNote.textContent = here
          ? `Your address, ${located.matchedAddress}, is in District ${here}.${located.exact ? '' : ' Shapes are simplified for display; close to a border, the block assignment file is the final word.'}`
          : `Your address, ${located.matchedAddress}, is marked on the map.`;
      }
      const liveMove = partway && balance.status === 'ready' ? route.move : null;
      const nextListKey = `${plan}|${selected}|${locatedDistrict(plan) ?? ''}|${liveMove ?? ''}|${partway}`;
      if (nextListKey !== listKey) {
        listKey = nextListKey;
        const which = liveMove !== null ? `after balancing move ${liveMove} of ${finishedMetrics.balanceMoves}` : plan === 'finished' ? 'finished map' : 'before balancing';
        list.update({
          districts,
          total: planStats.metrics.population,
          seats: entry.seats,
          colors: bundle.colors,
          selected,
          located: locatedDistrict(plan),
          caption: `${entry.name}, ${districtCount(entry.seats)}, ${which}. ${evenSplitSentence(planStats.metrics.population, entry.seats)}.${partway ? ' Counties are as before balancing.' : ''}`,
          partway,
        });
      }
      if (plan !== proofKey) {
        proofKey = plan;
        proof.update({ metrics: planStats.metrics, plan, abbr: entry.abbr });
      }
      options!.update({
        plan: route.plan,
        enacted: route.enacted,
        step: cutMode ? { phase: 'cut', k: Math.min(route.cut!, total), total } : balanceMode ? { phase: 'balance', m: route.move!, total: finishedMetrics.balanceMoves } : null,
        enactedFailed,
      });
      const pos: SeqPos | null = cutMode ? { phase: 'cut', k: Math.min(route.cut!, total) } : balanceMode ? { phase: 'balance', m: route.move! } : null;
      scrubber!.update(pos, { log: balance, canZoom: map !== null });

      clear(legendList);
      const sample = (cls: string, text?: string): HTMLElement => h('span', { class: cls, 'aria-hidden': 'true' }, text);
      const legendItems: (HTMLElement | null)[] = [
        h('span', { class: 'strv-legend__item' }, sample('strv-legend__num', '3'), 'District number'),
        cutMode ? h('span', { class: 'strv-legend__item' }, sample('strv-legend__tag', 'Cut 3'), 'Order of a cut') : null,
        h('span', { class: 'strv-legend__item' }, sample('strv-legend__chip', '+2'), 'More districts, zoom in'),
        bundle.water ? h('span', { class: 'strv-legend__item' }, sample('strv-legend__water'), 'Water, shown pale') : null,
        cutMode ? h('span', { class: 'strv-legend__item' }, sample('strv-legend__cut'), 'Newest cut') : null,
        cutMode ? h('span', { class: 'strv-legend__item' }, sample('strv-legend__past'), 'Earlier cuts') : null,
        balanceMode && (route.move ?? 0) > 0 ? h('span', { class: 'strv-legend__item' }, sample('strv-legend__move'), 'Block moved') : null,
        route.enacted ? h('span', { class: 'strv-legend__item' }, sample('strv-legend__dash'), `${congressName(bundle.stats.enactedSource)} districts`) : null,
      ];
      legendList.append(...legendItems.filter((x): x is HTMLElement => x !== null));

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

      map?.set(mapState(selected));
      animateNext = false;
    };
    const mapState = (selected: number | null) => ({
      plan: route.plan,
      cut: route.cut !== null ? Math.min(route.cut, total) : null,
      move: route.move,
      balance: balance.status === 'ready' ? balance.log : null,
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
    const at = toStateFrame(bundle.abbr, l.lonLat);
    const { districts, exact } = lookupDistricts({
      block: l.block ?? null,
      blocks,
      fingerprints: { finished: bundle.stats.finished.metrics.assignmentSha256, before: bundle.stats.beforeBalancing.metrics.assignmentSha256 },
      shapes: bundle,
      at,
    });
    located = { districts, lonLat: at, matchedAddress: l.matchedAddress, exact };
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
      frameWatch?.disconnect();
      splitWatch?.disconnect();
      scrubber?.destroy();
      map?.destroy();
    },
  };
}

