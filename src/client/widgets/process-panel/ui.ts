import { h, arrowTo, formatHash, formatInt, howRoute, peopleNoun, type HowSection } from '../../shared';
import type { Metrics } from '../../entities/plan';

export interface ProcessPanelOptions {
  stateName: string;
  /** The finished map's numbers; the counts of cuts, lines, strays and re-counts are the same in both plans. */
  metrics: Metrics;
  /** Opens the cut sequence or the balancing replay, playing. */
  onWatch(part: 'cuts' | 'balance'): void;
}

/** "12 to 340 for each cut." */
function perCut(per: readonly number[]): string {
  if (per.length === 0) return '';
  const lo = Math.min(...per);
  const hi = Math.max(...per);
  return lo === hi ? `${formatInt(lo)} for each cut.` : `${formatInt(lo)} to ${formatInt(hi)} for each cut.`;
}

const count = (n: number, one: string, many: string): string => `${formatInt(n)} ${n === 1 ? one : many}`;

/** "35.2 seconds", "1 minute 50 seconds" (rounded to the tenth of a second under a minute). */
export function formatRunTime(ms: number): string {
  const s = ms / 1000;
  if (s < 60) return `${s.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} seconds`;
  const whole = Math.round(s);
  const min = Math.floor(whole / 60);
  const sec = whole % 60;
  return `${count(min, 'minute', 'minutes')}${sec ? ` ${count(sec, 'second', 'seconds')}` : ''}`;
}

/**
 * "What happened in this state": the drawing of this state's map, stage by
 * stage, in its own numbers. Every figure comes from the state's published
 * stats file.
 */
export function createProcessPanel(opts: ProcessPanelOptions): HTMLElement {
  const m = opts.metrics;
  // Each label opens the stage of How it works that explains the figure, so a reader who meets a
  // word like "re-count" here can jump straight to its worked example.
  const row = (term: string, section: HowSection, fig: Node | string, sub: string): HTMLElement =>
    h(
      'div',
      { class: 'strv-process__row' },
      h('dt', null, h('a', { class: 'strv-process__term', href: formatHash(howRoute(section)), 'aria-label': `${term}: how this stage works` }, term)),
      h('dd', { class: 'strv-process__fig' }, fig),
      h('dd', { class: 'strv-process__sub' }, sub),
    );

  const single = m.seats === 1;
  const watch = (part: 'cuts' | 'balance', label: string, signal: boolean): HTMLElement =>
    h('button', { type: 'button', class: `strv-button${signal ? ' strv-button--signal' : ''}`, onclick: () => opts.onWatch(part) }, label);

  if (single) {
    return h(
      'section',
      { class: 'strv-process', 'aria-labelledby': 'strv-process-h' },
      h('h2', { id: 'strv-process-h', class: 'strv-h2' }, 'What happened in this state'),
      h('p', null, `${opts.stateName} has one seat, so the whole state is the one district. There was nothing to cut and nothing to balance.`),
      h(
        'dl',
        { class: 'strv-process__rows' },
        row('Cuts', 'recursion', '0', 'A state with one seat needs no cut.'),
        row('Balancing moves', 'balancing', '0', 'One district has no neighbor to balance against.'),
        row('Run time', 'fingerprint', formatRunTime(m.runtimeMs), 'To read the census file and check the district.'),
      ),
      h('p', { class: 'strv-process__how' }, h('a', { href: formatHash(howRoute()) }, 'How each stage works')),
    );
  }

  return h(
    'section',
    { class: 'strv-process', 'aria-labelledby': 'strv-process-h' },
    h('h2', { id: 'strv-process-h', class: 'strv-h2' }, 'What happened in this state'),
    h(
      'dl',
      { class: 'strv-process__rows' },
      row('Cuts', 'recursion', formatInt(m.cuts), `${m.seats} seats take ${count(m.cuts, 'cut', 'cuts')}. Each cut splits one piece of ${opts.stateName} in two.`),
      row(
        'Guide lines checked',
        'cut',
        formatInt(m.candidateRangesEvaluated),
        `Stretches of directions checked, so every straight line is covered. ${perCut(m.candidateRangesPerCut)}`,
      ),
      row(
        'Strays moved',
        'strays',
        count(m.strayBlocksMoved, 'block', 'blocks'),
        `${count(m.strayPopMoved, 'person', 'people')} in pieces cut off from their side joined the side around them.`,
      ),
      row(
        'Re-counts',
        'strays',
        formatInt(m.recounts),
        m.recounts === 0
          ? 'No line needed sliding again: the people still split evenly after the strays moved.'
          : `Times a line slid again so the people still split evenly after strays moved. At most ${count(m.recountsMaxPerCut, 'time', 'times')} for one cut.`,
      ),
      row('Balancing moves', 'balancing', formatInt(m.balanceMoves), `${count(m.peopleMovedByBalancing, 'person', 'people')} moved, one block at a time.`),
      row(
        'Population range',
        'balancing',
        h('span', { class: 'strv-nowrap' }, formatInt(m.rangeBeforeBalancing), arrowTo(), `${formatInt(m.rangeAfterBalancing)} ${peopleNoun(m.rangeAfterBalancing)}`),
        'Largest district minus smallest, before balancing and after.',
      ),
      row('Run time', 'fingerprint', formatRunTime(m.runtimeMs), 'To draw the whole state, from the census file to the finished map.'),
    ),
    h(
      'div',
      { class: 'strv-process__actions' },
      watch('cuts', `Watch the ${count(m.cuts, 'cut', 'cuts')}`, true),
      m.balanceMoves > 0 ? watch('balance', `Watch the ${count(m.balanceMoves, 'balancing move', 'balancing moves')}`, false) : null,
    ),
    h('p', { class: 'strv-process__how' }, h('a', { href: formatHash(howRoute()) }, 'How each stage works')),
  );
}
