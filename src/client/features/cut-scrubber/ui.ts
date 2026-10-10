import { h, clear, formatKm, formatInt, formatSignedPeople, peopleNoun, prefersReducedMotion, config, iconChevronDown, iconZoomIn, arrowTo } from '../../shared';
import { collidingTicks, sparseTicks } from './ticks';
import {
  cutRows,
  cutSides,
  seqStep,
  isSeqEnd,
  moveDetail,
  populationsAfter,
  rangeOf,
  balancePlayInterval,
  isFastReplay,
  rangeTrace,
  pageOf,
  pageAt,
  type Cut,
  type SeqPos,
  type SeqSize,
  type BalanceLog,
} from '../../entities/plan';

/** Where the balancing log stands: not asked for, on its way, failed, or here. */
export type BalanceLogState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string; retry(): void }
  | { status: 'ready'; log: BalanceLog };

export interface CutScrubberOptions {
  cuts: readonly Cut[];
  seats: number;
  /** Number of balancing moves, and what they did, from the state's numbers (known before the log itself loads). */
  moves: number;
  peopleMoved: number;
  rangeBefore: number;
  /** Visitor moved to a position. `animate` is false for jumps and reduced motion. */
  onStep(pos: SeqPos, opts: { animate: boolean }): void;
  /** Visitor asked for the finished map. */
  onFinish(): void;
  /** Visitor asked to see the moved block up close. */
  onZoomToMove(): void;
}

export interface CutScrubber {
  el: HTMLElement;
  /** null shows the finished-map state of the control. */
  update(pos: SeqPos | null, state: { log: BalanceLogState; canZoom: boolean }): void;
  /** Opens the cuts or the balancing and plays it (or waits on its first step, with reduced motion), as the start buttons do. */
  start(part: 'cuts' | 'balance'): void;
  destroy(): void;
}

/** Rows of the balancing timetable shown at once; a longer log turns pages. */
const MOVES_PER_PAGE = 50;

const plural = (n: number, one: string, many: string): string => `${formatInt(n)} ${n === 1 ? one : many}`;

function describeCut(k: number, cuts: readonly Cut[]): string {
  if (k === 0) return `Before the first cut. The whole state, ${cuts.length + 1} seats.`;
  const c = cuts[k - 1]!;
  const { low, high } = cutSides(c);
  const range = (r: [number, number]): string => (r[0] === r[1] ? `district ${r[0]}` : `districts ${r[0]} to ${r[1]}`);
  return `Cut ${k} of ${cuts.length}. Splits ${c.seats} seats into ${c.lowSeats} and ${c.highSeats}: ${range(low)} on one side, ${range(high)} on the other.`;
}

function describeMove(m: number, total: number, log: BalanceLog | null, rangeBefore: number): string {
  if (!log) return `Balancing move ${m} of ${total}. The list of moves is loading.`;
  if (m === 0) return `Balancing, before the first move. The largest and smallest districts are ${plural(rangeBefore, 'person', 'people')} apart.`;
  const d = moveDetail(log.before, log.moves, m)!;
  const range = rangeOf(populationsAfter(log.before, log.moves, m));
  return `Balancing move ${m} of ${total}. Block ${d.move.geoid}, ${plural(d.move.pop, 'person', 'people')}, from District ${d.move.from} to District ${d.move.to}. Gap between them from ${formatInt(d.gapBefore)} to ${plural(d.gapAfter, 'person', 'people')}. State range ${plural(range, 'person', 'people')}.`;
}

/** What stands in for the scrubber on a one-seat state: there is nothing to step through. */
function createSingleSeatNote(): CutScrubber {
  const el = h(
    'section',
    { class: 'strv-scrub', 'aria-label': 'Cuts and balancing' },
    h(
      'div',
      { class: 'strv-scrub__intro' },
      h('p', { class: 'strv-scrub__summary' }, h('strong', null, 'Finished map.'), ' This state has one seat, so there is nothing to cut or balance. The whole state is the one district.'),
    ),
  );
  return { el, update: () => undefined, start: () => undefined, destroy: () => undefined };
}

export function createCutScrubber(opts: CutScrubberOptions): CutScrubber {
  if (opts.cuts.length === 0 && opts.moves === 0) return createSingleSeatNote();
  const size: SeqSize = { cuts: opts.cuts.length, moves: opts.moves };
  const total = size.cuts;
  const replayPace = { baseMs: config.movePlayIntervalMs, totalMs: config.movePlayTotalMs, minMs: config.movePlayMinMs };
  let pos: SeqPos = { phase: 'cut', k: 0 };
  let active = false;
  let timer: number | null = null;
  let logState: BalanceLogState = { status: 'idle' };
  let canZoom = false;
  const log = (): BalanceLog | null => (logState.status === 'ready' ? logState.log : null);
  const phaseTotal = (): number => (pos.phase === 'cut' ? size.cuts : size.moves);
  const phaseAt = (): number => (pos.phase === 'cut' ? pos.k : pos.m);

  const countLabel = h('span', { class: 'strv-scrub__label' });
  const count = h('p', { class: 'strv-scrub__count', 'aria-hidden': 'true' });
  const detail = h('dl', { class: 'strv-scrub__detail' });
  const readoutText = h('p', { class: 'strv-scrub__readout-text' });
  const zoom = h('button', { type: 'button', class: 'strv-button strv-scrub__zoom', 'aria-label': 'Zoom to block' }, iconZoomIn(), h('span', { class: 'strv-scrub__zoom-text', 'aria-hidden': 'true' }, 'Zoom to block'));
  const readout = h('div', { class: 'strv-scrub__readout' }, readoutText, zoom);

  const range = h('input', { type: 'range', class: 'strv-scrub__range', min: 0, max: total, step: 1, value: 0, 'aria-label': 'Cut' });
  const ticks = h('ol', { class: 'strv-scrub__ticks', 'aria-hidden': 'true' });
  let tickPhase: SeqPos['phase'] | null = null;
  let sparse: number[] | null = null;
  /** The current step's own label on a sparse axis, which moves along it. */
  const floating = h('li', { 'data-state': 'current', 'data-floating': 'true' });

  /** The axis numbers: every cut (every fifth labelled on a long axis), or round numbers along the balancing moves. */
  function buildTicks(): void {
    if (tickPhase === pos.phase) return;
    tickPhase = pos.phase;
    clear(ticks);
    const n = phaseTotal();
    ticks.style.setProperty('--n', String(Math.max(n, 1)));
    if (pos.phase === 'cut') {
      sparse = null;
      const dense = n > 16;
      ticks.dataset.dense = String(dense);
      ticks.dataset.sparse = 'false';
      for (let i = 0; i <= n; i++) {
        const li = h('li', { 'data-k': i, 'data-major': String(!dense || i % 5 === 0 || i === n) }, String(i));
        li.style.setProperty('--i', String(i));
        ticks.append(li);
      }
      return;
    }
    sparse = sparseTicks(n);
    ticks.dataset.dense = 'false';
    ticks.dataset.sparse = 'true';
    for (const i of sparse) {
      const li = h('li', { 'data-k': i, 'data-major': 'true' }, String(i));
      li.style.setProperty('--i', String(i));
      ticks.append(li);
    }
    ticks.append(floating);
  }

  const prev = h('button', { type: 'button', class: 'strv-button', 'aria-label': 'Previous step' }, iconPrev());
  const next = h('button', { type: 'button', class: 'strv-button', 'aria-label': 'Next step' }, iconNext());
  const play = h('button', { type: 'button', class: 'strv-button strv-scrub__play' });
  const finish = h('button', { type: 'button', class: 'strv-button strv-scrub__finish' }, h('span', { class: 'strv-scrub__wide' }, 'Show finished map'), h('span', { class: 'strv-scrub__narrow', 'aria-hidden': 'true' }, 'Finished map'));

  // The two parts of the sequence, in order. Each opens at its start.
  const cutsTab = h('button', { type: 'button', class: 'strv-scrub__phase' }, h('span', null, 'Cuts'), h('span', { class: 'strv-scrub__phase-n' }, String(size.cuts)));
  const balanceTab = h('button', { type: 'button', class: 'strv-scrub__phase' }, h('span', null, 'Balancing'), h('span', { class: 'strv-scrub__phase-n' }, String(size.moves)));
  const phases = h('div', { class: 'strv-scrub__phases', role: 'group', 'aria-label': 'Part of the sequence' }, cutsTab, size.moves > 0 ? balanceTab : null);

  const startCuts = h('button', { type: 'button', class: 'strv-button strv-button--signal strv-scrub__start' }, iconPlay(), h('span', null, `Watch the ${plural(total, 'cut', 'cuts')}`));
  const startBalance = h('button', { type: 'button', class: 'strv-button strv-scrub__start' }, iconPlay(), h('span', null, `Watch the ${plural(size.moves, 'balancing move', 'balancing moves')}`));

  const stopPlaying = (): void => {
    const wasPlaying = timer !== null;
    if (timer !== null) window.clearInterval(timer);
    timer = null;
    renderPlay();
    // A long log plays quietly; the move it stops on is the one read out, so a screen reader knows where the replay ended.
    if (wasPlaying && active && pos.phase === 'balance') {
      const text = describeMove(pos.m, size.moves, log(), opts.rangeBefore);
      if (live.textContent !== text) live.textContent = text;
    }
  };

  const go = (p: SeqPos, animate: boolean): void => {
    pos = p;
    opts.onStep(p, { animate: animate && !prefersReducedMotion() });
  };

  const jump = (p: SeqPos): void => {
    stopPlaying();
    go(p, false);
  };

  /** True at the last step of the part of the sequence on screen. */
  const atPhaseEnd = (): boolean => phaseAt() >= phaseTotal();

  const startPlaying = (): void => {
    stopPlaying();
    // At the end of the cuts, Play carries on into the balancing; at the end of the balancing it plays it again.
    if (atPhaseEnd()) {
      if (pos.phase === 'cut' && size.moves > 0) go({ phase: 'balance', m: 0 }, false);
      else go(pos.phase === 'cut' ? { phase: 'cut', k: 0 } : { phase: 'balance', m: 0 }, false);
    }
    const phase = pos.phase;
    const interval = phase === 'cut' ? config.cutPlayIntervalMs : balancePlayInterval(size.moves, replayPace);
    const tick = (): void => {
      if (pos.phase !== phase || atPhaseEnd()) {
        stopPlaying();
        return;
      }
      // The balancing waits for its list of moves.
      if (phase === 'balance' && !log()) return;
      go(seqStep(pos, 1, size), true);
    };
    timer = window.setInterval(tick, interval);
    renderPlay();
    if (phaseAt() === 0 && (phase === 'cut' || log())) go(seqStep(pos, 1, size), true);
  };

  function renderPlay(): void {
    clear(play);
    const playing = timer !== null;
    const label = playing ? 'Pause' : pos.phase === 'cut' ? (atPhaseEnd() && size.moves > 0 ? 'Play the balancing' : 'Play the cuts in order') : 'Play the balancing moves in order';
    play.setAttribute('aria-label', label);
    play.append(playing ? iconPause() : iconPlay(), h('span', { class: 'strv-scrub__play-text' }, playing ? 'Pause' : 'Play'));
  }

  range.addEventListener('input', () => {
    stopPlaying();
    const v = Number(range.value);
    go(pos.phase === 'cut' ? { phase: 'cut', k: v } : { phase: 'balance', m: v }, false);
  });
  prev.addEventListener('click', () => {
    stopPlaying();
    go(seqStep(pos, -1, size), true);
  });
  next.addEventListener('click', () => {
    stopPlaying();
    go(seqStep(pos, 1, size), true);
  });
  play.addEventListener('click', () => (timer === null ? startPlaying() : stopPlaying()));
  finish.addEventListener('click', () => {
    stopPlaying();
    opts.onFinish();
  });
  zoom.addEventListener('click', () => opts.onZoomToMove());
  cutsTab.addEventListener('click', () => pos.phase !== 'cut' && jump({ phase: 'cut', k: 0 }));
  balanceTab.addEventListener('click', () => pos.phase !== 'balance' && jump({ phase: 'balance', m: 0 }));

  const open = (first: SeqPos, playFrom: SeqPos): void => {
    // With reduced motion the sequence opens on its first step and waits for the visitor.
    if (prefersReducedMotion()) go(first, false);
    else {
      go(playFrom, false);
      startPlaying();
    }
    keepInView();
  };
  const start = (part: 'cuts' | 'balance'): void =>
    part === 'cuts'
      ? open({ phase: 'cut', k: Math.min(1, total) }, { phase: 'cut', k: 0 })
      : open({ phase: 'balance', m: Math.min(1, size.moves) }, { phase: 'balance', m: 0 });
  startCuts.addEventListener('click', () => start('cuts'));
  startBalance.addEventListener('click', () => start('balance'));

  /** On a short screen the open controls can land below the fold; bring them up so the map and the controls are both on screen. */
  function keepInView(): void {
    requestAnimationFrame(() => {
      const over = el.getBoundingClientRect().bottom - window.innerHeight;
      if (over > 0) window.scrollBy({ top: over + 8, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    });
  }

  const live = h('p', { class: 'strv-visually-hidden', 'aria-live': 'polite' });

  // The cut timetable: every cut as a row, so the whole sequence can be read at once. A row jumps to its cut.
  const cutRowsEls = cutRows(opts.cuts).map((r) =>
    h(
      'tr',
      { 'data-k': r.order, onclick: () => jump({ phase: 'cut', k: r.order }) },
      h('th', { scope: 'row', class: 'strv-board__no' }, h('button', { type: 'button', class: 'strv-board__go', 'aria-label': `Go to cut ${r.order} of ${total}` }, String(r.order))),
      h('td', null, String(r.seats)),
      h('td', null, r.split),
      h('td', { class: 'strv-board__num' }, r.direction),
      h('td', { class: 'strv-board__num' }, r.border),
    ),
  );
  const cutHead = h(
    'thead',
    null,
    h('tr', null, h('th', { scope: 'col' }, 'Cut'), h('th', { scope: 'col' }, 'Seats'), h('th', { scope: 'col' }, 'Split'), h('th', { scope: 'col', class: 'strv-board__num' }, 'Direction'), h('th', { scope: 'col', class: 'strv-board__num' }, 'Border')),
  );
  const cutScroll = h(
    'div',
    { class: 'strv-board__scroll' },
    h('table', { class: 'strv-board__table' }, h('caption', { class: 'strv-visually-hidden' }, 'Every cut in order. Choose a cut number to jump to it.'), cutHead, h('tbody', null, cutRowsEls)),
  );
  const cutBoard = h('details', { class: 'strv-board' }, h('summary', { class: 'strv-board__summary' }, iconChevronDown(), h('span', null, `All ${plural(total, 'cut', 'cuts')}`)), cutScroll);

  // The balancing timetable: every move as a row (No., block, people, from, to), a page of them at a time on a long log.
  const moveHead = h(
    'thead',
    null,
    h(
      'tr',
      null,
      h('th', { scope: 'col' }, 'Move'),
      h('th', { scope: 'col' }, 'Block'),
      h('th', { scope: 'col', class: 'strv-board__num' }, 'People'),
      h('th', { scope: 'col', class: 'strv-board__num' }, 'From'),
      h('th', { scope: 'col', class: 'strv-board__num' }, 'To'),
    ),
  );
  const moveBody = h('tbody');
  const moveScroll = h(
    'div',
    { class: 'strv-board__scroll' },
    h('table', { class: 'strv-board__table' }, h('caption', { class: 'strv-visually-hidden' }, 'Every balancing move in order, with the block moved, its population, and the districts it left and joined. Choose a move number to jump to it.'), moveHead, moveBody),
  );
  const pageLabel = h('p', { class: 'strv-board__page', 'aria-live': 'polite' });
  const pagePrev = h('button', { type: 'button', class: 'strv-button strv-board__turn', 'aria-label': 'Earlier moves' }, iconPrevPage());
  const pageNext = h('button', { type: 'button', class: 'strv-button strv-board__turn', 'aria-label': 'Later moves' }, iconNextPage());
  const pager = h('div', { class: 'strv-board__pager' }, pagePrev, pageLabel, pageNext);
  pager.hidden = size.moves <= MOVES_PER_PAGE;
  const moveBoard = h(
    'details',
    { class: 'strv-board' },
    h('summary', { class: 'strv-board__summary' }, iconChevronDown(), h('span', null, `All ${plural(size.moves, 'balancing move', 'balancing moves')}`)),
    pager,
    moveScroll,
  );
  let shownPage = -1;
  let shownLog: BalanceLog | null = null;
  pagePrev.addEventListener('click', () => renderMovePage(shownPage - 1));
  pageNext.addEventListener('click', () => renderMovePage(shownPage + 1));

  function renderMovePage(page: number): void {
    const l = log();
    const p = pageAt(page, size.moves, MOVES_PER_PAGE);
    if (p.page === shownPage && l === shownLog) return markMoveRows();
    shownPage = p.page;
    shownLog = l;
    clear(moveBody);
    pageLabel.textContent = `Moves ${formatInt(p.start + 1)} to ${formatInt(p.end)} of ${formatInt(size.moves)}`;
    pagePrev.disabled = p.page === 0;
    pageNext.disabled = p.page >= p.pages - 1;
    if (!l) {
      moveBody.append(h('tr', null, h('td', { colspan: 5, class: 'strv-board__wait' }, 'Loading the moves…')));
      return;
    }
    for (let i = p.start; i < p.end; i++) {
      const mv = l.moves[i]!;
      moveBody.append(
        h(
          'tr',
          { 'data-k': mv.order, onclick: () => jump({ phase: 'balance', m: mv.order }) },
          h('th', { scope: 'row', class: 'strv-board__no' }, h('button', { type: 'button', class: 'strv-board__go', 'aria-label': `Go to move ${mv.order} of ${size.moves}` }, String(mv.order))),
          h('td', { class: 'strv-board__block' }, mv.geoid),
          h('td', { class: 'strv-board__num' }, formatInt(mv.pop)),
          h('td', { class: 'strv-board__num' }, String(mv.from)),
          h('td', { class: 'strv-board__num' }, String(mv.to)),
        ),
      );
    }
    markMoveRows();
  }

  function markMoveRows(): void {
    const m = pos.phase === 'balance' ? pos.m : 0;
    let current: HTMLElement | null = null;
    for (const tr of moveBody.children) {
      const row = tr as HTMLElement;
      const kk = Number(row.dataset.k);
      if (!kk) continue;
      row.dataset.state = kk === m ? 'current' : kk < m ? 'done' : 'todo';
      if (kk === m) {
        row.setAttribute('aria-current', 'step');
        current = row;
      } else row.removeAttribute('aria-current');
    }
    if (current && moveBoard.open) keepRowInView(moveScroll, moveHead, current);
  }

  for (const board of [cutBoard, moveBoard]) board.addEventListener('toggle', () => renderBoards());
  // Both timetables start closed (the <details> default): the controls stay short, so the map keeps most of the height. One tap opens a list.


  const top = h('div', { class: 'strv-scrub__top' }, phases, finish);
  // The state range after each balancing move, as a hairline step trace under the ticks. It is measurement: ink and one amber mark.
  const trace = h('div', { class: 'strv-scrub__trace', hidden: true });
  const controls = h('div', { class: 'strv-scrub__controls' }, h('div', { class: 'strv-scrub__buttons' }, prev, play, next), h('div', { class: 'strv-scrub__track' }, range, ticks, trace));
  let tracedLog: BalanceLog | null = null;
  let traceValues: number[] = [];
  let traceMax = 1;
  let traceMark: HTMLElement | null = null;

  /** Builds the trace once the balancing log is here; afterwards only the current-move mark moves. */
  function renderTrace(): void {
    const l = log();
    const show = pos.phase === 'balance' && l !== null && size.moves > 0;
    trace.hidden = !show;
    el.dataset.trace = String(show);
    if (!show || !l) return;
    if (tracedLog !== l) {
      tracedLog = l;
      traceValues = rangeTrace(l.before, l.moves);
      traceMax = Math.max(...traceValues, 1);
      clear(trace);
      const n = size.moves;
      let d = `M0 ${yPct(traceValues[0]!)}`;
      for (let i = 1; i <= n; i++) d += `H${((i / n) * 1000).toFixed(1)}V${yPct(traceValues[i]!)}`;
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 1000 100');
      svg.setAttribute('preserveAspectRatio', 'none');
      svg.setAttribute('class', 'strv-scrub__trace-svg');
      svg.setAttribute('role', 'img');
      svg.setAttribute('aria-label', `Range: ${plural(traceValues[0]!, 'person', 'people')} before balancing, ${formatInt(traceValues[n]!)} after.`);
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', d);
      svg.append(path);
      traceMark = h('span', { class: 'strv-scrub__trace-mark', 'aria-hidden': 'true' });
      trace.append(
        svg,
        traceMark,
        // The range only falls, so the top right corner of the trace is always clear.
        h('span', { class: 'strv-scrub__trace-label', 'aria-hidden': 'true' }, 'Range ', formatInt(traceValues[0]!), arrowTo(), formatInt(traceValues[n]!)),
      );
    }
    const m = pos.phase === 'balance' ? Math.min(pos.m, size.moves) : 0;
    traceMark!.style.left = `${(m / size.moves) * 100}%`;
    traceMark!.style.top = `${yPct(traceValues[m]!)}%`;
  }
  /** Height of a range on the trace, in percent from the top: the largest range is at the top, zero at the bottom. */
  function yPct(v: number): string {
    return (100 - (v / traceMax) * 100).toFixed(2);
  }

  const intro = h(
    'div',
    { class: 'strv-scrub__intro' },
    h(
      'p',
      { class: 'strv-scrub__summary' },
      h('strong', null, 'Finished map.'),
      ` ${opts.seats} districts from ${total} straight-line ${total === 1 ? 'cut' : 'cuts'}`,
      size.moves > 0 ? `, then ${plural(size.moves, 'balancing move', 'balancing moves')}.` : '.',
    ),
    h('div', { class: 'strv-scrub__starts' }, startCuts, size.moves > 0 ? startBalance : null),
  );

  const el = h(
    'section',
    { class: 'strv-scrub', 'aria-label': 'Cuts and balancing, step by step' },
    intro,
    h('div', { class: 'strv-scrub__body' }, top, h('div', { class: 'strv-scrub__head' }, count, detail), readout, controls, cutBoard, moveBoard),
    live,
  );

  /** A figure with its caption; `more` is the longer half of the sub-line, dropped on a narrow strip. */
  const pair = (term: string, value: Node | string, sub?: string, more?: string): HTMLElement =>
    h('div', null, h('dt', null, term), h('dd', null, value), sub ? h('dd', { class: 'strv-scrub__sub' }, sub, more ? h('span', { class: 'strv-scrub__wide' }, more) : null) : null);

  function renderDetail(): void {
    clear(detail);
    clear(count);
    const n = phaseTotal();
    const at = phaseAt();
    countLabel.textContent = pos.phase === 'cut' ? 'Cut' : 'Balancing move';
    count.append(countLabel, h('span', { class: 'strv-scrub__fig' }, h('span', { class: 'strv-scrub__k' }, String(at)), h('span', { class: 'strv-scrub__of' }, ` of ${formatInt(n)}`)));

    if (pos.phase === 'cut') {
      if (at === 0) {
        detail.append(pair('State', `Whole, ${opts.seats} seats`));
        return;
      }
      const c = opts.cuts[at - 1]!;
      const { low, high } = cutSides(c);
      const r = (x: [number, number]): string => (x[0] === x[1] ? `${x[0]}` : `${x[0]}–${x[1]}`);
      detail.append(
        pair('Splits', `${c.seats} seats: ${c.lowSeats} + ${c.highSeats}`),
        pair('Districts', `${r(low)} | ${r(high)}`),
        pair('Direction', `${c.angleDeg.toFixed(2)}°`),
        pair('Border', formatKm(c.lengthM)),
      );
      return;
    }

    const l = log();
    clear(readoutText);
    zoom.hidden = true;
    if (logState.status === 'error') {
      readoutText.append(logState.message, ' ');
      const retry = logState.retry;
      readoutText.append(h('button', { type: 'button', class: 'strv-button strv-scrub__retry', onclick: () => retry() }, 'Try again'));
      return;
    }
    if (!l) {
      readoutText.textContent = 'Loading the balancing moves…';
      return;
    }
    if (at === 0) {
      readoutText.append(`Balancing starts from the plan the cuts left. Each move takes one block across a border, only when it narrows the gap between the two districts.`);
      detail.append(
        pair('State range', plural(opts.rangeBefore, 'person', 'people'), 'Largest minus smallest'),
        pair('Moves to come', formatInt(n), `${plural(opts.peopleMoved, 'person', 'people')}`, ' in all'),
      );
      return;
    }
    const d = moveDetail(l.before, l.moves, at)!;
    const pops = populationsAfter(l.before, l.moves, at);
    const stateRange = rangeOf(pops);
    readoutText.append(
      h('strong', null, `Move ${formatInt(at)}:`),
      ` block ${d.move.geoid}, ${plural(d.move.pop, 'person', 'people')}, from District ${d.move.from} to District ${d.move.to}. Gap between them: `,
      h('span', { class: 'strv-nowrap' }, formatInt(d.gapBefore), arrowTo(), `${plural(d.gapAfter, 'person', 'people')}.`),
    );
    if (at === n) readoutText.append(h('span', { class: 'strv-scrub__done' }, ' Balancing is done: this is the finished map.'));
    zoom.hidden = !canZoom;
    detail.append(
      pair(`District ${d.move.from}`, formatInt(d.fromAfter), formatSignedPeople(-d.move.pop), ' this move'),
      pair(`District ${d.move.to}`, formatInt(d.toAfter), formatSignedPeople(d.move.pop), ' this move'),
      pair('State range', plural(stateRange, 'person', 'people'), `was ${formatInt(opts.rangeBefore)}`, ' before balancing'),
    );
  }

  /** Marks the current cut's row and keeps it in view inside the table's own box (the page does not scroll). */
  function renderBoards(): void {
    cutBoard.hidden = pos.phase !== 'cut';
    moveBoard.hidden = pos.phase !== 'balance';
    if (pos.phase === 'cut') {
      const k = pos.k;
      cutRowsEls.forEach((tr, i) => {
        const kk = i + 1;
        tr.dataset.state = kk === k ? 'current' : kk < k ? 'done' : 'todo';
        if (kk === k) tr.setAttribute('aria-current', 'step');
        else tr.removeAttribute('aria-current');
      });
      const row = cutRowsEls[k - 1];
      if (row && cutBoard.open) keepRowInView(cutScroll, cutHead, row);
      return;
    }
    // Follow the current move to its page.
    renderMovePage(pageOf(Math.max(pos.m - 1, 0), size.moves, MOVES_PER_PAGE).page);
  }

  /** Hides the fixed tick label that the current-step label would sit on. */
  function markTicks(): void {
    const n = phaseTotal();
    const at = phaseAt();
    const hide = collidingTicks(n, at, ticks.clientWidth || 300, sparse ?? undefined);
    for (const li of ticks.children) {
      const item = li as HTMLElement;
      if (item === floating) continue;
      const kk = Number(item.dataset.k);
      item.dataset.state = kk === at ? 'current' : kk < at ? 'done' : 'todo';
      // On a sparse axis the floating label stands for the current step, so a fixed label at the same spot gives way too.
      item.dataset.collide = String(hide.has(kk) || (sparse !== null && kk === at));
    }
    if (sparse) {
      floating.textContent = String(at);
      floating.style.setProperty('--i', String(at));
    }
  }

  function update(p: SeqPos | null, state: { log: BalanceLogState; canZoom: boolean }): void {
    const wasActive = active;
    logState = state.log;
    canZoom = state.canZoom;
    active = p !== null;
    el.dataset.active = String(active);
    if (!active) {
      stopPlaying();
      // The sequence controls are about to disappear; a keyboard visitor who was on one lands on the button that reopens it.
      if (wasActive && el.contains(document.activeElement) && !intro.contains(document.activeElement)) startCuts.focus({ preventScroll: true });
      return;
    }
    const phaseChanged = p!.phase !== pos.phase;
    pos = p!;
    if (phaseChanged && timer !== null) stopPlaying();
    el.dataset.phase = pos.phase;
    const n = phaseTotal();
    const at = phaseAt();
    buildTicks();
    range.max = String(n);
    range.value = String(at);
    range.setAttribute('aria-label', pos.phase === 'cut' ? 'Cut' : 'Balancing move');
    const text = pos.phase === 'cut' ? describeCut(at, opts.cuts) : describeMove(at, n, log(), opts.rangeBefore);
    range.setAttribute('aria-valuetext', text);
    cutsTab.setAttribute('aria-pressed', String(pos.phase === 'cut'));
    balanceTab.setAttribute('aria-pressed', String(pos.phase === 'balance'));
    prev.disabled = pos.phase === 'cut' && pos.k === 0;
    next.disabled = isSeqEnd(pos, size);
    prev.setAttribute('aria-label', pos.phase === 'cut' ? 'Previous cut' : pos.m === 0 ? 'Back to the last cut' : 'Previous move');
    next.setAttribute('aria-label', pos.phase === 'cut' ? (pos.k === size.cuts ? 'On to the balancing' : 'Next cut') : 'Next move');
    readout.hidden = pos.phase !== 'balance';
    markTicks();
    renderDetail();
    renderBoards();
    renderTrace();
    renderPlay();
    // The slider reads its own value text when it has focus; the live region covers Play and the buttons.
    // A long log playing fast is not read move by move (stopPlaying reads the step it stops on).
    const quiet = timer !== null && pos.phase === 'balance' && isFastReplay(size.moves, replayPace);
    if (document.activeElement !== range && !quiet) live.textContent = text;
    if (!wasActive) {
      // Keep keyboard users on the control they used to enter the sequence.
      if (document.activeElement === startCuts || document.activeElement === startBalance) range.focus();
    }
  }

  renderPlay();
  update(null, { log: { status: 'idle' }, canZoom: false });
  // The axis is measured, so a resize (a phone turned, a window dragged) recomputes which labels fit.
  const tickObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(() => active && markTicks()) : null;
  tickObserver?.observe(ticks);

  return {
    el,
    update,
    start,
    destroy() {
      stopPlaying();
      tickObserver?.disconnect();
    },
  };
}

/** Keeps a row in view inside its table's own scrolling box, below the sticky head. */
function keepRowInView(box: HTMLElement, head: HTMLElement, row: HTMLElement): void {
  const top = row.offsetTop - head.offsetHeight;
  const bottom = row.offsetTop + row.offsetHeight;
  if (top < box.scrollTop) box.scrollTop = top;
  else if (bottom > box.scrollTop + box.clientHeight) box.scrollTop = bottom - box.clientHeight;
}

function svgIcon(d: string): SVGSVGElement {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 16 16');
  s.setAttribute('width', '16');
  s.setAttribute('height', '16');
  s.setAttribute('aria-hidden', 'true');
  s.setAttribute('focusable', 'false');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', d);
  s.append(p);
  return s;
}

const iconPlay = (): SVGSVGElement => svgIcon('M4.5 2.75v10.5L13 8z');
const iconPause = (): SVGSVGElement => svgIcon('M4 3h3v10H4zM9 3h3v10H9z');
const iconPrev = (): SVGSVGElement => svgIcon('M3 3h1.75v10H3zM13 3v10L5.75 8z');
const iconNext = (): SVGSVGElement => svgIcon('M11.25 3H13v10h-1.75zM3 3v10l7.25-5z');
const iconPrevPage = (): SVGSVGElement => svgIcon('M11 3v10L4 8z');
const iconNextPage = (): SVGSVGElement => svgIcon('M5 3v10l7-5z');
