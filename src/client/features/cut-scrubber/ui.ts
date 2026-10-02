import { h, clear, formatKm, prefersReducedMotion, config, iconChevronDown } from '../../shared';
import { collidingTicks } from './ticks';
import { cutRows, cutSides, cutStep, stepBy, isLastStep, type Cut, type CutStep } from '../../entities/plan';

export interface CutScrubberOptions {
  cuts: readonly Cut[];
  seats: number;
  /** Visitor moved to step k (0 = whole state). `animate` is false for jumps and reduced motion. */
  onStep(k: number, opts: { animate: boolean }): void;
  /** Visitor asked for the finished map. */
  onFinish(): void;
}

export interface CutScrubber {
  el: HTMLElement;
  /** null shows the finished-map state of the control. */
  update(k: number | null): void;
  destroy(): void;
}

function describeStep(s: CutStep, cuts: readonly Cut[]): string {
  if (s.k === 0) return `Before the first cut. The whole state, ${cuts.length + 1} seats.`;
  const c = cuts[s.k - 1]!;
  const { low, high } = cutSides(c);
  const range = (r: [number, number]): string => (r[0] === r[1] ? `district ${r[0]}` : `districts ${r[0]} to ${r[1]}`);
  return `Cut ${s.k} of ${s.total}. Splits ${c.seats} seats into ${c.lowSeats} and ${c.highSeats}: ${range(low)} on one side, ${range(high)} on the other.`;
}

export function createCutScrubber(opts: CutScrubberOptions): CutScrubber {
  const total = opts.cuts.length;
  let step = cutStep(0, total);
  let active = false;
  let timer: number | null = null;

  const count = h('p', { class: 'strv-scrub__count', 'aria-hidden': 'true' });
  const detail = h('dl', { class: 'strv-scrub__detail' });

  const range = h('input', {
    type: 'range',
    class: 'strv-scrub__range',
    min: 0,
    max: total,
    step: 1,
    value: 0,
    'aria-label': 'Cut',
  });

  const dense = total > 16;
  const ticks = h(
    'ol',
    { class: 'strv-scrub__ticks', 'aria-hidden': 'true', style: `--n:${Math.max(total, 1)}`, 'data-dense': String(dense) },
    Array.from({ length: total + 1 }, (_, i) =>
      h('li', { 'data-k': i, style: `--i:${i}`, 'data-major': String(!dense || i % 5 === 0 || i === total) }, String(i)),
    ),
  );

  const prev = h('button', { type: 'button', class: 'strv-button', 'aria-label': 'Previous cut' }, iconPrev());
  const next = h('button', { type: 'button', class: 'strv-button', 'aria-label': 'Next cut' }, iconNext());
  const play = h('button', { type: 'button', class: 'strv-button strv-scrub__play' });
  const finish = h('button', { type: 'button', class: 'strv-button strv-scrub__finish' }, 'Show finished map');
  const start = h('button', { type: 'button', class: 'strv-button strv-button--signal strv-scrub__start' });

  const stopPlaying = (): void => {
    if (timer !== null) window.clearInterval(timer);
    timer = null;
    renderPlay();
  };

  const jump = (k: number): void => {
    stopPlaying();
    go(k, false);
  };

  const go = (k: number, animate: boolean): void => {
    step = cutStep(k, total);
    opts.onStep(step.k, { animate: animate && !prefersReducedMotion() });
  };

  const startPlaying = (): void => {
    if (isLastStep(step)) go(0, false);
    timer = window.setInterval(() => {
      if (isLastStep(step)) {
        stopPlaying();
        return;
      }
      go(stepBy(step, 1).k, true);
    }, config.cutPlayIntervalMs);
    renderPlay();
    if (step.k === 0) go(1, true);
  };

  function renderPlay(): void {
    clear(play);
    const playing = timer !== null;
    play.setAttribute('aria-label', playing ? 'Pause' : 'Play the cuts in order');
    play.append(playing ? iconPause() : iconPlay(), h('span', { class: 'strv-scrub__play-text' }, playing ? 'Pause' : 'Play'));
  }

  range.addEventListener('input', () => {
    stopPlaying();
    go(Number(range.value), false);
  });
  prev.addEventListener('click', () => {
    stopPlaying();
    go(step.k - 1, true);
  });
  next.addEventListener('click', () => {
    stopPlaying();
    go(step.k + 1, true);
  });
  play.addEventListener('click', () => (timer === null ? startPlaying() : stopPlaying()));
  finish.addEventListener('click', () => {
    stopPlaying();
    opts.onFinish();
  });
  start.addEventListener('click', () => {
    // With reduced motion the sequence opens on cut 1 and waits for the visitor.
    if (prefersReducedMotion()) go(1, false);
    else {
      go(0, false);
      startPlaying();
    }
    keepInView();
  });
  start.append(iconPlay(), h('span', null, `Watch the ${total} ${total === 1 ? 'cut' : 'cuts'}`));

  /** On a short screen the open controls can land below the fold; bring them up so the map and the controls are both on screen. */
  function keepInView(): void {
    requestAnimationFrame(() => {
      const over = el.getBoundingClientRect().bottom - window.innerHeight;
      if (over > 0) window.scrollBy({ top: over + 8, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    });
  }

  const live = h('p', { class: 'strv-visually-hidden', 'aria-live': 'polite' });

  // The timetable: every cut as a row, so the whole sequence can be read at once. A row jumps to its cut.
  const boardRows = cutRows(opts.cuts).map((r) =>
    h(
      'tr',
      { 'data-k': r.order, onclick: () => jump(r.order) },
      h('th', { scope: 'row', class: 'strv-board__no' }, h('button', { type: 'button', class: 'strv-board__go', 'aria-label': `Go to cut ${r.order} of ${total}` }, String(r.order))),
      h('td', null, String(r.seats)),
      h('td', null, r.split),
      h('td', { class: 'strv-board__num' }, r.direction),
      h('td', { class: 'strv-board__num' }, r.border),
    ),
  );
  const boardHead = h(
    'thead',
    null,
    h('tr', null, h('th', { scope: 'col' }, 'Cut'), h('th', { scope: 'col' }, 'Seats'), h('th', { scope: 'col' }, 'Split'), h('th', { scope: 'col', class: 'strv-board__num' }, 'Direction'), h('th', { scope: 'col', class: 'strv-board__num' }, 'Border')),
  );
  const boardScroll = h(
    'div',
    { class: 'strv-board__scroll' },
    h('table', { class: 'strv-board__table' }, h('caption', { class: 'strv-visually-hidden' }, 'Every cut in order. Choose a cut number to jump to it.'), boardHead, h('tbody', null, boardRows)),
  );
  const board = h('details', { class: 'strv-board' }, h('summary', { class: 'strv-board__summary' }, iconChevronDown(), h('span', null, `All ${total} ${total === 1 ? 'cut' : 'cuts'}`)), boardScroll);
  // Open where there is room for it beside the map; a phone keeps the map and controls on one screen.
  board.addEventListener('toggle', () => renderBoard());
  board.open = typeof matchMedia === 'function' && matchMedia('(min-width: 64rem) and (min-height: 40rem)').matches;

  const controls = h(
    'div',
    { class: 'strv-scrub__controls' },
    h('div', { class: 'strv-scrub__buttons' }, prev, play, next),
    h('div', { class: 'strv-scrub__track' }, range, ticks),
    finish,
  );

  const intro = h(
    'div',
    { class: 'strv-scrub__intro' },
    h('p', { class: 'strv-scrub__summary' }, h('strong', null, 'Finished map.'), ` ${opts.seats} districts from ${total} straight-line ${total === 1 ? 'cut' : 'cuts'}, then balanced.`),
    start,
  );

  const el = h('section', { class: 'strv-scrub', 'aria-label': 'Cut sequence' }, intro, h('div', { class: 'strv-scrub__body' }, h('div', { class: 'strv-scrub__head' }, count, detail), controls, board), live);

  function renderDetail(): void {
    clear(detail);
    count.textContent = '';
    if (step.k === 0) {
      count.append(h('span', { class: 'strv-scrub__k' }, '0'), h('span', { class: 'strv-scrub__of' }, ` of ${total}`));
      detail.append(h('div', null, h('dt', null, 'State'), h('dd', null, `Whole, ${opts.seats} seats`)));
      return;
    }
    const c = opts.cuts[step.k - 1]!;
    const { low, high } = cutSides(c);
    const r = (x: [number, number]): string => (x[0] === x[1] ? `${x[0]}` : `${x[0]}–${x[1]}`);
    count.append(h('span', { class: 'strv-scrub__k' }, String(step.k)), h('span', { class: 'strv-scrub__of' }, ` of ${total}`));
    detail.append(
      h('div', null, h('dt', null, 'Splits'), h('dd', null, `${c.seats} seats: ${c.lowSeats} + ${c.highSeats}`)),
      h('div', null, h('dt', null, 'Districts'), h('dd', null, `${r(low)} | ${r(high)}`)),
      h('div', null, h('dt', null, 'Direction'), h('dd', null, `${c.angleDeg.toFixed(1)}°`)),
      h('div', null, h('dt', null, 'Border'), h('dd', null, formatKm(c.lengthM))),
    );
  }

  /** Marks the current cut's row and keeps it in view inside the table's own box (the page does not scroll). */
  function renderBoard(): void {
    boardRows.forEach((tr, i) => {
      const kk = i + 1;
      tr.dataset.state = kk === step.k ? 'current' : kk < step.k ? 'done' : 'todo';
      if (kk === step.k) tr.setAttribute('aria-current', 'step');
      else tr.removeAttribute('aria-current');
    });
    const row = boardRows[step.k - 1];
    if (!row || !board.open) return;
    const top = row.offsetTop - boardHead.offsetHeight;
    const bottom = row.offsetTop + row.offsetHeight;
    if (top < boardScroll.scrollTop) boardScroll.scrollTop = top;
    else if (bottom > boardScroll.scrollTop + boardScroll.clientHeight) boardScroll.scrollTop = bottom - boardScroll.clientHeight;
  }

  /** Hides the fixed tick label that the current-step label would sit on. */
  function markCollisions(): void {
    const hide = collidingTicks(total, step.k, ticks.clientWidth || 300);
    for (const li of ticks.children) (li as HTMLElement).dataset.collide = String(hide.has(Number((li as HTMLElement).dataset.k)));
  }

  function update(k: number | null): void {
    const wasActive = active;
    active = k !== null;
    el.dataset.active = String(active);
    if (!active) {
      stopPlaying();
      // The sequence controls are about to disappear; a keyboard visitor who was on one lands on the button that reopens it.
      if (wasActive && controls.contains(document.activeElement)) start.focus({ preventScroll: true });
      return;
    }
    step = cutStep(k!, total);
    range.value = String(step.k);
    range.setAttribute('aria-valuetext', describeStep(step, opts.cuts));
    prev.disabled = step.k === 0;
    next.disabled = isLastStep(step);
    for (const li of ticks.children) {
      const kk = Number((li as HTMLElement).dataset.k);
      (li as HTMLElement).dataset.state = kk === step.k ? 'current' : kk < step.k ? 'done' : 'todo';
    }
    markCollisions();
    renderDetail();
    renderBoard();
    // The slider reads its own value text when it has focus; the live region covers Play and the buttons.
    if (document.activeElement !== range) live.textContent = describeStep(step, opts.cuts);
    if (!wasActive) {
      // Keep keyboard users on the control they used to enter the sequence.
      if (document.activeElement === start) range.focus();
    }
  }

  renderPlay();
  update(null);
  // The axis is measured, so a resize (a phone turned, a window dragged) recomputes which labels fit.
  const tickObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(() => active && markCollisions()) : null;
  tickObserver?.observe(ticks);

  return {
    el,
    update,
    destroy() {
      stopPlaying();
      tickObserver?.disconnect();
    },
  };
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
