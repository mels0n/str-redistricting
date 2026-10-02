import {
  h,
  clear,
  describeError,
  formatHash,
  formatInt,
  formatPeople,
  getLocated,
  setLocated,
  peopleNoun,
  stateRoute,
  NATIONAL,
  UnknownStateError,
  type Navigate,
  type Page,
  type Route,
  type LonLat,
} from '../../shared';
import { loadIndex, loadOutlines, findState, isGenerated, type GeneratedState } from '../../entities/state';
import { loadStateBundle, loadEnacted, districtAt, type StateBundle, type EnactedShapes } from '../../entities/plan';
import { createAddressSearch } from '../../features/address-search';
import { createCutScrubber, type CutScrubber } from '../../features/cut-scrubber';
import { createPlanOptions, type PlanOptions } from '../../features/plan-options';
import { createDistrictMap, type DistrictMapView } from '../../widgets/district-map';
import { createDistrictTicket } from '../../widgets/district-ticket';
import { createDistrictList } from '../../widgets/district-list';
import { createProofPanel } from '../../widgets/proof-panel';
import { createExplainer } from '../../widgets/explainer';

type StateRoute = Extract<Route, { page: 'state' }>;

export function createStatePage(initial: StateRoute, nav: Navigate): Page {
  let route = initial;
  let alive = true;
  let hovered: number | null = null;
  let animateNext = false;
  let enacted: EnactedShapes | null = null;
  let located: { district: number | null; lonLat: LonLat; matchedAddress: string } | null = null;

  const h1 = h('h1', { class: 'strv-state__h1', tabindex: -1 }, initial.abbr);
  const back = h('a', { href: formatHash(NATIONAL), class: 'strv-back' }, h('span', { 'aria-hidden': 'true' }, '← '), 'All states');
  const meta = h('dl', { class: 'strv-state__meta' });
  const head = h('header', { class: 'strv-state__head' }, back, h1, meta);

  const mapEl = h('div', { class: 'strv-state__map', role: 'region', 'aria-label': 'District map', 'aria-busy': 'true' });
  const legend = h('div', { class: 'strv-legend', 'aria-hidden': 'true' });
  const mapFrame = h('div', { class: 'strv-state__frame' }, mapEl, legend);
  const stage = h('div', { class: 'strv-state__stage' }, mapFrame);
  const panel = h('div', { class: 'strv-state__panel' }, head);
  const el = h('main', { class: 'strv-state', id: 'strv-main', 'data-cut-mode': 'false' }, panel, stage);

  let map: DistrictMapView | null = null;
  let scrubber: CutScrubber | null = null;
  let options: PlanOptions | null = null;
  let render: (light?: boolean) => void = () => undefined;

  const go = (patch: Partial<StateRoute>, replace = false): void => nav({ ...route, ...patch }, { replace });

  function showError(err: unknown, retry?: () => void): void {
    clear(mapEl);
    mapEl.removeAttribute('aria-busy');
    mapEl.append(
      h(
        'div',
        { class: 'strv-error', role: 'alert' },
        h('p', null, describeError(err)),
        retry ? h('button', { type: 'button', class: 'strv-button', onclick: retry }, 'Try again') : null,
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

  function setMeta(state: GeneratedState): void {
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

  async function start(): Promise<void> {
    mapEl.setAttribute('aria-busy', 'true');
    clear(mapEl);
    mapEl.append(h('p', { class: 'strv-loading' }, 'Loading the map…'));
    let index;
    try {
      index = await loadIndex();
    } catch (err) {
      if (alive) showError(err, () => void start());
      return;
    }
    if (!alive) return;
    const entry = findState(index, route.abbr);
    if (!entry) {
      h1.textContent = route.abbr;
      showError(new UnknownStateError(route.abbr));
      return;
    }
    if (!isGenerated(entry)) {
      showNotGenerated(entry.name);
      return;
    }
    h1.textContent = entry.name;
    mapEl.setAttribute('aria-label', `Map of ${entry.name}’s ${entry.seats} districts. Every district is also listed in the Districts table.`);
    setMeta(entry);
    document.title = `${entry.name}: ${entry.seats} districts drawn by rule`;
    clear(mapEl);
    mapEl.append(h('p', { class: 'strv-loading' }, `Loading the map of ${entry.name}…`));

    let bundle: StateBundle;
    let outlines;
    try {
      [bundle, outlines] = await Promise.all([loadStateBundle(entry.abbr), loadOutlines()]);
    } catch (err) {
      if (alive) showError(err, () => void start());
      return;
    }
    if (!alive) return;
    build(entry, bundle, index);
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
      if (alive) showError(err, () => void start());
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
        if (result.state !== entry.abbr) {
          const other = findState(index, result.state);
          if (!other) return `${result.matchedAddress} is outside the 50 states covered here.`;
          if (!isGenerated(other)) return `${result.matchedAddress} is in ${other.name}. The map for ${other.name} has not been generated.`;
          setLocated({ state: other.abbr, lonLat: result.lonLat, matchedAddress: result.matchedAddress });
          nav(stateRoute(other.abbr));
          return `Found ${result.matchedAddress}. Opening ${other.name}.`;
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
    panel.append(
      h('div', { class: 'strv-state__ticket' }, ticket.el, locatedNote),
      h('div', { class: 'strv-state__search' }, search.el),
      h('div', { class: 'strv-state__options' }, options.el),
      h('div', { class: 'strv-state__list' }, list.el),
      h('div', { class: 'strv-state__proof' }, proof.el),
      h('div', { class: 'strv-state__explain' }, createExplainer({ seats: entry.seats })),
    );

    locate(bundle);
    if (located?.district && route.district === null) go({ district: located.district }, true);

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
      list.update({
        districts: planStats.districts,
        colors: bundle.colors,
        selected,
        located: located?.district ?? null,
        caption: `${entry.name}, ${entry.seats} districts, ${plan === 'official' ? 'official map' : 'before balancing'}. Ideal district: ${formatPeople(planStats.metrics.ideal)} people.`,
      });
      proof.update({ metrics: planStats.metrics, plan, abbr: entry.abbr });
      options!.update({ plan: route.plan, enacted: route.enacted, cutMode });
      scrubber!.update(route.cut === null ? null : Math.min(route.cut, total));

      clear(legend);
      const legendItems: (HTMLElement | null)[] = [
        h('span', { class: 'strv-legend__item' }, h('span', { class: 'strv-legend__num' }, '3'), 'District number'),
        cutMode ? h('span', { class: 'strv-legend__item' }, h('span', { class: 'strv-legend__cut' }), 'Newest cut') : null,
        cutMode ? h('span', { class: 'strv-legend__item' }, h('span', { class: 'strv-legend__past' }), 'Earlier cuts') : null,
        route.enacted ? h('span', { class: 'strv-legend__item' }, h('span', { class: 'strv-legend__dash' }), 'Today’s districts') : null,
      ];
      legend.append(...legendItems.filter((x): x is HTMLElement => x !== null));

      if (route.enacted && !enacted) {
        loadEnacted(entry.abbr)
          .then((e) => {
            enacted = e;
            render();
          })
          .catch(() => {
            options!.el.dataset.error = 'true';
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
      route = next;
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

