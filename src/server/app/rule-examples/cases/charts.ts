import {
  chosenCandidate, generatedStates, loadCandidates, loadMetricsIfPresent, type CaseBuilder, type ExtractContext, type RuleCase,
} from '../../../features/rule-examples/index.js';
import { compareCandidates, decidingTieRule } from '../../../features/splitline/index.js';
import { DataError } from '../../../shared/errors/index.js';
import { nameOf, people, whole } from './panel.js';
import { cutTrace } from './trace.js';

type Label = NonNullable<RuleCase['labels']>[number];

const VIEW = { w: 320, h: 180 };
/** Where axis words sit: on the row under the plot, at its two ends. The chart reserves this strip. */
const AXIS_Y = 170;
const AXIS_L = 24;
const AXIS_R = 296;

/** The cut that shows the order of the checks: its shortest line is skipped for stray pieces it could not settle. */
const ORDER = { abbr: 'MS', cut: 1 } as const;
const BALANCE_STATE = 'CO';
/** A two-district state, where the two districts are always exactly as far from the ideal as each other. */
const TIE_STATE = 'HI';

const round2 = (n: number): number => Math.round(n * 100) / 100;
/** An angle for display: one decimal, no trailing zero. */
const deg = (angle: number): string => `${Number(angle.toFixed(1))}°`;
const axisLabel = (id: string, x: number, text: string): Label => ({ id, x, y: AXIS_Y, text });

/** A numeric field of a record whose schema passes extra fields through. */
function numberField(rec: object, key: string, what: string): number {
  const v = (rec as Record<string, unknown>)[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new DataError(`${what}: no number "${key}"`);
  return v;
}

/** One candidate line, as the generator ranks them. */
export interface Cand {
  readonly k: number;
  readonly lowSeats: number;
  readonly lengthM: number;
}

/**
 * Candidate rows of one cut by the generator's order: border length, then closeness to north-south, then angle, then
 * first-side seats. candidates.json holds whole meters, so lines within a meter of each other may rank differently here
 * than in the generator, which compares exact lengths; tiesCase re-runs the cut to check.
 */
function ranked(rows: readonly number[][], fields: readonly string[], angleCount: number): { cand: Cand; unresolved: boolean }[] {
  const at = (f: string): number => fields.indexOf(f);
  const [kAt, lowAt, lenAt, unAt] = [at('k'), at('lowSeats'), at('lengthM'), at('unresolved')];
  if (kAt < 0 || lowAt < 0 || lenAt < 0 || unAt < 0) throw new DataError('candidates.json is missing a column the charts read');
  const cmp = compareCandidates(angleCount);
  return rows
    .map((r) => ({ cand: { k: r[kAt]!, lowSeats: r[lowAt]!, lengthM: r[lenAt]! }, unresolved: r[unAt] === 1 }))
    .sort((p, q) => cmp(p.cand, q.cand));
}

/** The two shortest resolved candidates of a cut in the generator's order, or undefined when fewer than two are resolved. */
export function shortestTwo(rows: readonly number[][], fields: readonly string[], angleCount: number): [Cand, Cand] | undefined {
  const ok = ranked(rows, fields, angleCount).filter((r) => !r.unresolved);
  return ok.length < 2 ? undefined : [ok[0]!.cand, ok[1]!.cand];
}

/** Which of two equally long candidates goes first, and by which rule: 1 closer to north-south, 2 smaller angle, 3 fewer first-side seats. */
export function tieRule(a: Pick<Cand, 'k' | 'lowSeats'>, b: Pick<Cand, 'k' | 'lowSeats'>, angleCount: number): { first: 'a' | 'b'; rule: 1 | 2 | 3 } {
  return decidingTieRule(angleCount)(a, b);
}

/**
 * The 0-based index of the value furthest from zero on either side. When two are equally far, the one with the
 * smaller `firsts` entry (the district whose first block comes first in GEOID order) wins; without `firsts`, the lower index.
 */
export function furthestOf(devs: readonly number[], firsts?: readonly number[]): number {
  let best = 0;
  devs.forEach((d, i) => {
    const [far, farthest] = [Math.abs(d), Math.abs(devs[best]!)];
    if (far > farthest || (far === farthest && firsts !== undefined && firsts[i]! < firsts[best]!)) best = i;
  });
  return best;
}

/** cut.order-of-checks: every direction's settled border, the unresolved ones, the sort, the first usable line. */
export async function orderOfChecksCase(ctx: ExtractContext): Promise<RuleCase> {
  const { abbr, cut: order } = ORDER;
  const out = await ctx.state(abbr);
  const at = out.cutStats.cuts.findIndex((c) => c.order === order);
  const cut = out.cutStats.cuts[at];
  const all = out.candidates.cuts[at];
  if (!cut || !all) throw new DataError(`${abbr}: no cut ${order} in the cut data`);
  const step = out.metrics.angleStepDeg;
  const skippedCount = numberField(cut, 'skipped', `${abbr} cut ${order}`);
  if (skippedCount < 1) throw new DataError(`${abbr} cut ${order}: no line was skipped, so this cut no longer shows the order of the checks`);

  // One row per direction: a cut with an even seat count has a single way to split the seats.
  const { lowSeats } = chosenCandidate(out, at);
  const lowAt = out.candidates.fields.indexOf('lowSeats');
  const rows = all.filter((r) => r[lowAt] === lowSeats);
  const n = rows.length;
  const angleCount = Math.round(180 / step);
  if (n !== angleCount) throw new DataError(`${abbr} cut ${order}: ${n} candidates for ${angleCount} directions`);
  const list = ranked(rows, out.candidates.fields, angleCount);
  const values = new Array<number>(n).fill(-1);
  for (const { cand } of list) values[cand.k] = cand.lengthM / 1000;
  if (values.some((v) => v < 0)) throw new DataError(`${abbr} cut ${order}: a direction has no candidate row`);

  const unresolved = list.filter((r) => r.unresolved).map((r) => r.cand.k).sort((a, b) => a - b);
  // Lines ahead of the one that was used, in the generator's order: all of them unresolved, as many as cut-stats counts.
  const used = list.findIndex((r) => !r.unresolved);
  const skipped = list.slice(0, used).map((r) => r.cand.k);
  const winner = list[used]!.cand;
  if (skipped.length !== skippedCount) throw new DataError(`${abbr} cut ${order}: ${skipped.length} lines ahead of the winner, cut-stats counts ${skippedCount}`);
  if (winner.lengthM !== cut.lengthM || (winner.k * 180) / angleCount !== cut.angleDeg) throw new DataError(`${abbr} cut ${order}: the shortest resolved line is not the cut on disk`);

  const km = (m: number): string => (m / 1000).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const name = nameOf(abbr);
  const top = values.reduce((a, v) => Math.max(a, v), 0);
  const shortest = list[0]!.cand;
  const lastAngle = ((n - 1) * 180) / angleCount;
  const one = skipped.length === 1;
  const base = ['chart', 'ymax'];
  const angles = [...base, 'x-angle-l', 'x-angle-r'];
  const byLength = [...base, 'x-sorted-l', 'x-sorted-r', 'chart-sorted'];
  return {
    id: 'cut.order-of-checks',
    state: abbr,
    stateName: name,
    source: { cut: cut.order, angleDeg: cut.angleDeg },
    link: { state: abbr, cut: cut.order },
    view: VIEW,
    labels: [
      { id: 'ymax', x: 44, y: 11, text: `${whole(Math.round(top))} km` },
      axisLabel('x-angle-l', AXIS_L, '0°'),
      axisLabel('x-angle-r', AXIS_R, deg(lastAngle)),
      axisLabel('x-sorted-l', AXIS_L, 'shortest'),
      axisLabel('x-sorted-r', AXIS_R, 'longest'),
    ],
    steps: [
      { caption: `${name}'s first cut tries ${whole(n)} straight lines, one every ${step}° from 0° to ${deg(lastAngle)}. Each line is first settled for stray pieces, and only then is its real border measured. Each tick is that measured length.`, show: angles },
      { caption: `Settling cannot fix every line. For ${whole(unresolved.length)} of the ${whole(n)}, the two sides are still not each one connected piece. They are marked.`, show: [...angles, 'chart-unresolved'] },
      { caption: `Now the lines are sorted by border length, shortest first.`, show: [...byLength, 'chart-unresolved'] },
      { caption: `The shortest line, ${deg((shortest.k * 180) / angleCount)} at ${km(shortest.lengthM)} km, is one of the unresolved ones. ${one ? 'It is' : 'They are'} skipped.`, show: [...byLength, 'chart-unresolved', 'chart-skipped'] },
      {
        caption: `The next line, ${deg(cut.angleDeg)} at ${km(winner.lengthM)} km, has two connected sides, so it is the cut. It is the ${deg(cut.angleDeg)} and ${whole(cut.lengthM)} m of cut ${cut.order} on the real map.`,
        show: [...byLength, 'chart-unresolved', 'chart-skipped', 'chart-winner'],
      },
    ],
    chart: { kind: 'strip', values, marks: { unresolved, skipped, winner: [winner.k] } },
  };
}

interface Close {
  readonly abbr: string;
  readonly blocks: number;
  readonly order: number;
  readonly angleCount: number;
  readonly gapM: number;
  readonly pair: [Cand, Cand];
}

interface CloseCalls {
  readonly states: number;
  readonly cuts: number;
  /** Cuts whose two shortest borders are equal to the meter. */
  readonly equal: number;
  readonly closest: Close;
}

/**
 * The search behind cut.ties: for every cut of every generated state, the two shortest resolved borders and how
 * far apart they are (candidates.json holds whole meters). The closest pair, on the fewest blocks, is the example.
 */
export async function closeCalls(ctx: ExtractContext): Promise<CloseCalls> {
  const { outDir } = ctx.cfg;
  const abbrs = generatedStates(outDir);
  let cuts = 0, equal = 0;
  let closest: Close | undefined;
  for (const abbr of abbrs) {
    const [metrics, cands] = await Promise.all([loadMetricsIfPresent(outDir, abbr), loadCandidates(outDir, abbr)]);
    if (!metrics) continue;
    const angleCount = numberField(metrics, 'angleCount', abbr);
    const blocks = numberField(metrics, 'blocks', abbr);
    cands.cuts.forEach((rows, i) => {
      const pair = shortestTwo(rows, cands.fields, angleCount);
      if (!pair) return;
      cuts++;
      const gapM = pair[1].lengthM - pair[0].lengthM;
      if (gapM === 0) equal++;
      const here: Close = { abbr, blocks, order: i + 1, angleCount, gapM, pair };
      if (!closest || gapM < closest.gapM || (gapM === closest.gapM && blocks < closest.blocks)) closest = here;
    });
  }
  if (!closest) throw new DataError(`${outDir}: no cuts to search for ties`);
  return { states: abbrs.length, cuts, equal, closest };
}

/** The distance of a line at `angle` degrees from north-south, 0 to 90. */
const fromNorthSouth = (angle: number): number => Math.min(angle, 180 - angle);

/** How far apart two lengths are, in words: meters from a meter up, centimeters from a centimeter, millimeters down to a micrometer. */
export function gapWords(m: number): string {
  if (m >= 1) return `${people(round2(m))} m`;
  if (m >= 0.01) return `${(m * 100).toFixed(1)} cm`;
  if (m >= 1e-6) return `${(m * 1000).toPrecision(2)} mm`;
  return 'less than a thousandth of a millimeter';
}

/** cut.ties: the closest call in any state, re-run at full precision to say whether the two lengths are exactly equal. */
export async function tiesCase(ctx: ExtractContext): Promise<RuleCase> {
  const found = await closeCalls(ctx);
  const { abbr, order, angleCount } = found.closest;
  const t = await cutTrace(ctx, abbr, order);
  const lengthOf = (c: Cand): number => {
    const s = t.result.candidateStats.find((x) => x.k === c.k && x.lowSeats === c.lowSeats);
    if (!s) throw new DataError(`${abbr} cut ${order}: no candidate k=${c.k} in the re-run`);
    return s.lengthM;
  };
  // candidates.json holds whole meters, so order the pair again by the full lengths of the re-run, as the generator does.
  const [first, second] = found.closest.pair
    .map((c) => ({ ...c, lengthM: lengthOf(c) }))
    .sort(compareCandidates(angleCount)) as [Cand, Cand];
  const [lenFirst, lenSecond] = [first.lengthM, second.lengthM];
  const tied = lenFirst === lenSecond;
  if ((first.k * 180) / angleCount !== t.cut.angleDeg) {
    throw new DataError(`${abbr} cut ${order}: the shortest resolved line is not the cut on disk (its sides were not connected?)`);
  }
  const name = nameOf(abbr);
  const angle = (c: Cand): number => (c.k * 180) / angleCount;
  const [a, b] = [deg(angle(first)), deg(angle(second))];
  const meters = (m: number): string => people(round2(m));
  const mark = tied ? 'tied' : 'close';
  const decided = tieRule(first, second, angleCount);

  const search = found.equal > 0
    ? `Searching every cut in all ${found.states} states: in ${found.equal} of ${whole(found.cuts)} cuts the two shortest settled borders agree to the meter. The one on the fewest blocks is ${name}'s cut ${order}, measured in full below.`
    : `Searching every cut in all ${found.states} states: none of ${whole(found.cuts)} cuts has two shortest settled borders that agree to the meter. The closest is ${name}'s cut ${order}.`;
  const rule = decided.rule === 1
    ? `A tie goes to the line closest to north-south. ${a} leans ${deg(fromNorthSouth(angle(first)))} from north-south and ${b} leans ${deg(fromNorthSouth(angle(second)))}, so ${a} goes first.`
    : decided.rule === 2
      ? `Both lines lean ${deg(fromNorthSouth(angle(first)))} from north-south, so the smaller angle goes first: ${a} before ${b}.`
      : `Both lines have the same angle, so the one whose first side has fewer seats goes first: ${first.lowSeats} before ${second.lowSeats}.`;

  return {
    id: 'cut.ties',
    state: abbr,
    stateName: name,
    source: { cut: order, angleDeg: t.cut.angleDeg },
    link: { state: abbr, cut: order },
    view: VIEW,
    steps: [
      { caption: search, show: [] },
      { caption: `${name}'s cut ${order} splits ${t.cut.seats} seats. Its two shortest borders run at ${a} and ${b}.`, show: ['chart'] },
      {
        caption: tied
          ? `Both borders are ${meters(lenFirst)} m, exactly the same length when measured in full, so they are tied.`
          : `The closest call in any state: ${a} and ${b}, ${gapWords(lenSecond - lenFirst)} apart when measured in full. Not a tie.`,
        show: ['chart', `chart-${mark}`],
      },
      {
        caption: tied ? rule : `Not a tie, so the shorter border, at ${a}, is the one used.`,
        show: ['chart', `chart-${mark}`],
      },
      {
        caption: `So the cut is the line at ${a}. On the real map, ${name} cut ${order} is ${deg(t.cut.angleDeg)} and ${whole(t.cut.lengthM)} m.`,
        show: ['chart', `chart-${mark}`, 'chart-winner'],
      },
    ],
    chart: { kind: 'bars', values: [round2(lenFirst), round2(lenSecond)], labels: [a, b], marks: { [mark]: [0, 1], winner: [0] } },
  };
}

/** balance.furthest: each district's distance from the ideal before balancing, and the one the pass starts with. */
export async function furthestCase(ctx: ExtractContext): Promise<RuleCase> {
  const abbr = BALANCE_STATE;
  const [out, hi, hiBlocks] = await Promise.all([ctx.state(abbr), ctx.state(TIE_STATE), ctx.blocks(TIE_STATE)]);
  const { ideal } = out.metrics;
  const devs = out.balance.before.map((p) => p - ideal);
  const worst = furthestOf(devs);
  const move = out.balance.moves[0];
  if (!move || (move.from !== worst + 1 && move.to !== worst + 1)) throw new DataError(`${abbr}: the first move does not involve the furthest district`);
  // The furthest district on the other side of the ideal, to show that the side does not matter.
  const sign = Math.sign(devs[worst]!);
  const others = devs.map((d, i) => [d, i] as const).filter(([d]) => Math.sign(d) === -sign);
  const rival = others.reduce((best, [d, i]) => (Math.abs(d) > Math.abs(devs[best]!) ? i : best), others[0]?.[1] ?? -1);
  if (rival < 0) throw new DataError(`${abbr}: every district is on one side of the ideal`);

  const hiDevs = hi.balance.before.map((p) => p - hi.metrics.ideal);
  if (hiDevs.length !== 2 || Math.abs(hiDevs[0]!) !== Math.abs(hiDevs[1]!)) throw new DataError(`${TIE_STATE}: its two districts are not equally far from the ideal`);
  // The tied district whose first block (lowest block index, GEOID order) comes first goes first.
  const hiFirsts = hiDevs.map(() => Infinity);
  for (let i = hiBlocks.blocks.length - 1; i >= 0; i--) {
    const d = hi.before.get(hiBlocks.blocks[i]!.geoid);
    if (d === undefined) throw new DataError(`${TIE_STATE}: block ${hiBlocks.blocks[i]!.geoid} is not in the plan before balancing`);
    hiFirsts[d - 1] = i;
  }
  const hiFirst = furthestOf(hiDevs, hiFirsts);
  const side = (d: number): string => (d > 0 ? 'over' : 'under');
  const dist = (i: number): string => `District ${i + 1} is ${people(Math.abs(devs[i]!))} ${side(devs[i]!)}`;
  const name = nameOf(abbr);

  return {
    id: 'balance.furthest',
    state: abbr,
    stateName: name,
    source: { move: 1 },
    link: { state: abbr, move: 1 },
    view: VIEW,
    steps: [
      { caption: `${name}'s ideal is ${people(ideal)} people per district. Each bar is how far a district is from it before balancing: above the line is over, below is under.`, show: ['chart'] },
      { caption: `Distance counts either way. ${dist(worst)} and ${dist(rival)}, so District ${worst + 1} is further.`, show: ['chart', 'chart-runnerUp', 'chart-furthest'] },
      {
        caption: `District ${worst + 1} goes first. The first real move takes ${whole(out.balance.moves[0]!.pop)} people out of District ${move.from} and into District ${move.to}.`,
        show: ['chart', 'chart-furthest'],
      },
      {
        caption: `If two districts are exactly as far, the one whose first block comes first in GEOID order goes first. ${nameOf(TIE_STATE)}'s two districts are each ${people(Math.abs(hiDevs[0]!))} people from its ideal of ${people(hi.metrics.ideal)}, one over and one under, so District ${hiFirst + 1} goes first.`,
        show: [],
      },
    ],
    chart: { kind: 'bars', values: devs, labels: devs.map((_, i) => String(i + 1)), marks: { runnerUp: [rival], furthest: [worst] } },
  };
}

/** balance.stop: the sum of squared distances falls with every move until none helps. */
export async function stopCase(ctx: ExtractContext): Promise<RuleCase> {
  const abbr = BALANCE_STATE;
  const out = await ctx.state(abbr);
  const { ideal, districts } = out.metrics;
  const { before, moves } = out.balance;
  const sumOfSquares = (pops: readonly number[]): number => pops.reduce((s, p) => s + (p - ideal) * (p - ideal), 0);
  const values = [sumOfSquares(before)];
  for (const m of moves) values.push(values[values.length - 1]! - m.gain);
  const final = values[values.length - 1]!;
  if (final !== sumOfSquares(districts.map((d) => d.pop))) throw new DataError(`${abbr}: the moves' gains do not add up to the final plan`);
  const range = (pops: readonly number[]): number => Math.max(...pops) - Math.min(...pops);
  const [rangeBefore, rangeAfter] = [numberField(out.metrics, 'rangeBeforeBalancing', abbr), numberField(out.metrics, 'rangeAfterBalancing', abbr)];
  if (range(before) !== rangeBefore || range(districts.map((d) => d.pop)) !== rangeAfter) throw new DataError(`${abbr}: the ranges in metrics.json do not match the populations`);
  const n = moves.length;
  const lowest = moves.reduce((m, x) => Math.min(m, x.gain), Infinity);
  const name = nameOf(abbr);
  const chart = ['chart', 'x-start', 'x-end'];

  return {
    id: 'balance.stop',
    state: abbr,
    stateName: name,
    source: { move: n },
    link: { state: abbr, move: n },
    view: VIEW,
    labels: [axisLabel('x-start', AXIS_L, 'Start'), axisLabel('x-end', AXIS_R, `Move ${n}`)],
    steps: [
      {
        caption: `Before balancing, ${name}'s districts run from ${whole(Math.min(...before))} to ${whole(Math.max(...before))} people, a range of ${whole(rangeBefore)}. Squaring each district's distance from the ideal ${people(ideal)} and adding up gives ${people(values[0]!)}.`,
        show: [...chart, 'chart-first'],
      },
      { caption: `Each of the ${n} moves lowers that sum, the first by ${whole(moves[0]!.gain)} and the last by ${whole(moves[n - 1]!.gain)}. Each dot is the sum after a move.`, show: chart },
      { caption: `After ${n} moves the sum is ${people(final)} and the range is ${whole(rangeAfter)}.`, show: [...chart, 'chart-last'] },
      { caption: `No move lowers the sum any further, so the pass stops. It always does: every move lowers the sum by at least ${whole(lowest)}, and a sum of squares never goes below zero.`, show: [...chart, 'chart-last'] },
    ],
    chart: { kind: 'series', values, marks: { first: [0], last: [n] } },
  };
}

export const chartCases: readonly CaseBuilder[] = [orderOfChecksCase, tiesCase, furthestCase, stopCase];
