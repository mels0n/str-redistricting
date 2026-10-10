import type { BlockPolygons } from '../../../entities/census-block/index.js';
import { balance, type BalanceResult, type BalanceRound, type RoundCandidate } from '../../../features/balance/index.js';
import {
  generatedStates, projectWindow, type CaseBuilder, type ExtractContext, type RuleCase, type StateBlocks, type StateOutput,
} from '../../../features/rule-examples/index.js';
import { DataError } from '../../../shared/errors/index.js';
import { greatCircleDistance } from '../../../shared/geo/index.js';
import { dot, nameOf, people, ringArea, whole, type P } from './panel.js';

type Label = NonNullable<RuleCase['labels']>[number];
type RuleBlock = NonNullable<RuleCase['blocks']>[number];
type Line = NonNullable<RuleCase['lines']>[number];

const W = 320;
/** Blocks in a map window. */
const WINDOW = 24;
/** The balancing panels use Colorado, whose first move is the one the How page names. */
const ABBR = 'CO';

const ids = (xs: readonly { id: string }[]): string[] => xs.map((x) => x.id);
const plural = (n: number, one: string, many: string): string => `${whole(n)} ${n === 1 ? one : many}`;
const list = (xs: readonly string[]): string => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/** The generator's balancing pass for a state, re-run from its plan before balancing with every round observed. */
export interface BalanceRun {
  readonly abbr: string;
  readonly out: StateOutput;
  readonly sb: StateBlocks;
  /** 0-based district of every block before balancing. */
  readonly input: Int32Array;
  readonly result: BalanceResult;
  readonly rounds: readonly BalanceRound[];
}

const runs = new WeakMap<ExtractContext, Map<string, Promise<BalanceRun>>>();

/** Re-run a state's balancing pass once per extract run; fails when it does not reproduce balance.json (stale out/). */
export function balanceRun(ctx: ExtractContext, abbr: string): Promise<BalanceRun> {
  let cache = runs.get(ctx);
  if (!cache) { cache = new Map(); runs.set(ctx, cache); }
  let hit = cache.get(abbr);
  if (!hit) {
    hit = (async () => {
      const [out, sb] = await Promise.all([ctx.state(abbr), ctx.blocks(abbr)]);
      const input = Int32Array.from(sb.blocks, (b) => {
        const d = out.before.get(b.geoid);
        if (d === undefined) throw new DataError(`${abbr}: block ${b.geoid} is not in the plan before balancing`);
        return d - 1;
      });
      const rounds: BalanceRound[] = [];
      const result = balance(sb.blocks, sb.topo, input, out.balance.before.length, { onRound: (r) => rounds.push(r) });
      const same = result.moves.length === out.balance.moves.length && result.moves.every((m, i) => {
        const d = out.balance.moves[i]!;
        return m.geoid === d.geoid && m.from + 1 === d.from && m.to + 1 === d.to && m.pop === d.pop && m.gain === d.gain;
      });
      if (!same) throw new DataError(`${abbr}: re-running balancing does not give the moves in balance.json (stale out/?)`);
      return { abbr, out, sb, input, result, rounds };
    })();
    cache.set(abbr, hit);
  }
  return hit;
}

/** Each district's population just before move `k` (0-based), from balance.json. */
function popsBefore(out: StateOutput, k: number): number[] {
  const pops = [...out.balance.before];
  for (const m of out.balance.moves.slice(0, k)) { pops[m.from - 1]! -= m.pop; pops[m.to - 1]! += m.pop; }
  return pops;
}

/** The `n` blocks of the state whose internal points are nearest block `b`'s, nearest first (ties by block index). */
function nearestTo(run: BalanceRun, b: number, n: number): number[] {
  const at = run.sb.blocks[b]!.point;
  return run.sb.blocks
    .map((x, i) => [i, greatCircleDistance(at, x.point)] as const)
    .sort((p, q) => p[1] - q[1] || p[0] - q[0])
    .slice(0, n)
    .map(([i]) => i);
}

interface Window {
  /** Drawn largest first, so a block inside another's hole is drawn on top of it; each carries its 1-based district before balancing. */
  readonly blocks: RuleBlock[];
  readonly idOf: (b: number) => string;
  /** One dot per block, at its internal point; ids `<prefix><i>`. */
  readonly pins: (bs: readonly number[], prefix: string) => Line[];
}

function windowOf(run: BalanceRun, around: readonly number[], h: number): Window {
  const blocks = around.map((b) => run.sb.blocks[b]!);
  // Each ring as its own polygon: projectWindow keeps the largest, which is the outer ring.
  const polys = new Map<string, BlockPolygons>(blocks.map((b) => [b.geoid, b.rings.map((r) => [r])]));
  const { project, rings } = projectWindow(blocks, polys, { w: W, h });
  const at = new Map(around.map((b, i) => [b, `b${i}`] as const));
  const out = around.map((b, i): RuleBlock => {
    const blk = run.sb.blocks[b]!;
    const ring = rings.get(blk.geoid);
    if (!ring) throw new DataError(`${run.abbr}: block ${blk.geoid} has no outline`);
    return { id: `b${i}`, geoid: blk.geoid, pop: blk.pop, ring, district: run.input[b]! + 1 };
  });
  out.sort((p, q) => ringArea(q.ring as P[]) - ringArea(p.ring as P[]) || (p.id < q.id ? -1 : 1));
  return {
    blocks: out,
    idOf: (b) => {
      const id = at.get(b);
      if (!id) throw new DataError(`${run.abbr}: block ${run.sb.blocks[b]!.geoid} is not in the window`);
      return id;
    },
    pins: (bs, prefix) => bs.map((b, i) => ({ id: `${prefix}${i}`, pts: dot(project(run.sb.blocks[b]!.point)), tag: 'point' })),
  };
}

/** Each district's first block (lowest block index, which is GEOID order) in `assignment`; a district with no block is absent. */
function firstBlocks(assignment: ArrayLike<number>, seats: number): number[] {
  const first = new Array<number>(seats).fill(Infinity);
  for (let i = assignment.length - 1; i >= 0; i--) first[assignment[i]!] = i;
  return first;
}

/** A round's candidates grouped by block. */
function byBlock(cands: readonly RoundCandidate[]): Map<number, RoundCandidate[]> {
  const m = new Map<number, RoundCandidate[]>();
  for (const c of cands) m.set(c.block, [...(m.get(c.block) ?? []), c]);
  return m;
}

type Verdict = 'allowed' | NonNullable<RoundCandidate['reason']>;
const verdictOf = (c: RoundCandidate): Verdict => c.reason ?? 'allowed';
const VERDICTS: readonly Verdict[] = ['no-people', 'widens', 'disconnects', 'allowed'];

/** Blocks of `from` cut off from the rest of it if `block` left: every piece but the one with the most blocks. */
function stranded(run: BalanceRun, block: number, from: number): number[] {
  const { topo } = run.sb;
  const seen = new Uint8Array(run.input.length);
  seen[block] = 1;
  const pieces: number[][] = [];
  for (let s = 0; s < run.input.length; s++) {
    if (seen[s] || run.input[s] !== from) continue;
    const piece = [s];
    seen[s] = 1;
    for (let q = 0; q < piece.length; q++) {
      const i = piece[q]!;
      for (let k = topo.adjOffsets[i]!; k < topo.adjOffsets[i + 1]!; k++) {
        const j = topo.adjList[k]!;
        if (!seen[j] && run.input[j] === from) { seen[j] = 1; piece.push(j); }
      }
    }
    pieces.push(piece);
  }
  pieces.sort((p, q) => q.length - p.length || p[0]! - q[0]!);
  return pieces.slice(1).flat().sort((a, b) => a - b);
}

/**
 * The window for balance.allowed: centered on a move of the first round that would split the giving district,
 * taken in the generator's ranking, whose 24 nearest blocks hold every verdict (no people, widens, disconnects,
 * allowed), give each block one verdict, and lie in just the two districts of a move. The one with the most
 * border blocks wins; ties go to the higher-ranked center.
 */
function allowedWindow(run: BalanceRun): { around: number[]; verdicts: Map<number, Verdict>; other: number } {
  const first = run.rounds[0]!;
  const d = first.furthest;
  const blocks = byBlock(first.candidates);
  let best: { around: number[]; verdicts: Map<number, Verdict>; other: number } | undefined;
  for (const c of first.candidates.filter((x) => x.reason === 'disconnects')) {
    const around = nearestTo(run, c.block, WINDOW);
    const districts = new Set(around.map((b) => run.input[b]!));
    const other = c.from === d ? c.to : c.from;
    if (districts.size !== 2 || !districts.has(d) || !districts.has(other)) continue;
    const verdicts = new Map<number, Verdict>();
    let single = true;
    for (const b of around) {
      const vs = new Set((blocks.get(b) ?? []).map(verdictOf));
      if (vs.size > 1) single = false;
      if (vs.size === 1) verdicts.set(b, [...vs][0]!);
    }
    if (!single || !VERDICTS.every((v) => [...verdicts.values()].includes(v))) continue;
    if (!best || verdicts.size > best.verdicts.size) best = { around, verdicts, other };
  }
  if (!best) throw new DataError(`${run.abbr}: no window on the first balancing round shows every verdict`);
  return best;
}

/** balance.allowed: the border of the furthest district, and the three checks a move must pass. */
export async function allowedCase(ctx: ExtractContext): Promise<RuleCase> {
  const run = await balanceRun(ctx, ABBR);
  const first = run.rounds[0]!;
  const d = first.furthest;
  if (first.tried.length !== 1) throw new DataError(`${run.abbr}: the first round tried more than one district`);
  const { around, verdicts, other } = allowedWindow(run);
  const MAP_H = 156;
  const win = windowOf(run, around, MAP_H);
  const pops = popsBefore(run.out, 0);
  const [gd, go] = [d + 1, other + 1];
  const bigger = pops[d]! > pops[other]! ? gd : go;
  const gap = Math.abs(pops[d]! - pops[other]!);
  const of = (v: Verdict): number[] => around.filter((b) => verdicts.get(b) === v);
  const [none, widen, split, ok] = [of('no-people'), of('widens'), of('disconnects'), of('allowed')];
  const cands = first.candidates;
  const border = [...verdicts.keys()];
  const mark = (bs: readonly number[], v: string): Record<string, string> => Object.fromEntries(bs.map((b) => [win.idOf(b), v]));

  // Which moves the widening ones are: all from the smaller district into the bigger, or mixed.
  const widenMoves = cands.filter((c) => widen.includes(c.block));
  const intoBigger = widenMoves.every((c) => c.to + 1 === bigger);
  const smaller = bigger === gd ? go : gd;
  const widenText = intoBigger
    ? `A move must narrow the gap between the two districts, here ${plural(gap, 'person', 'people')}. Here ${plural(widen.length, 'move', 'moves')} would take people from District ${smaller} into District ${bigger}, which already has more, so ${widen.length === 1 ? 'it would' : 'they would'} widen it.`
    : `A move must narrow the gap between the two districts, here ${plural(gap, 'person', 'people')}. Here ${plural(widen.length, 'move', 'moves')} would widen it instead.`;

  // Why a split: the blocks of the giving district that would be cut off, when they are in view.
  const shown = new Set(around);
  const cut = [...new Set(split.flatMap((b) => {
    const c = cands.find((x) => x.block === b)!;
    const lost = stranded(run, b, c.from);
    if (!lost.length) throw new DataError(`${run.abbr}: block ${run.sb.blocks[b]!.geoid} was refused for splitting its district, but nothing is cut off without it`);
    return lost;
  }))];
  const cutInView = cut.filter((b) => shown.has(b));
  const pins = cutInView.length === cut.length ? win.pins(cut, 'cut') : [];
  const splitText = `District ${gd} must stay one connected piece. Without ${split.length === 1 ? 'this block' : `either of these ${whole(split.length)} blocks`} it would split${pins.length ? `, cutting off the ${plural(cut.length, 'dotted block', 'dotted blocks')}` : ''}, so ${split.length === 1 ? 'it stays' : 'they stay'}.`;

  const allowedAll = cands.filter((c) => c.allowed).length;
  const intoOther = ok.every((b) => cands.filter((c) => c.block === b).every((c) => c.to === other));
  const name = nameOf(run.abbr);
  // How far this stretch is from the block move 1 takes, which the panel's link opens.
  const move = run.result.moves[0];
  if (!move) throw new DataError(`${run.abbr}: balancing made no move`);
  const km = (greatCircleDistance(run.sb.blocks[move.block]!.point, run.sb.blocks[around[0]!]!.point) / 1000).toFixed(1);
  const B = ids(win.blocks);
  const labels: Label[] = [
    { id: 'gd', x: 80, y: 176, text: `District ${gd}: ${whole(pops[d]!)}` },
    { id: 'go', x: 240, y: 176, text: `District ${go}: ${whole(pops[other]!)}` },
  ];
  const base = [...B, 'gd', 'go'];
  return {
    id: 'balance.allowed',
    state: run.abbr,
    stateName: name,
    source: { move: 1 },
    link: { state: run.abbr, move: 1 },
    view: { w: W, h: 190 },
    blocks: win.blocks,
    lines: pins,
    labels,
    steps: [
      {
        caption: `Before balancing, District ${gd} is furthest from ${name}'s ideal, so its border is checked first. These ${whole(around.length)} blocks are one stretch of that border, where it meets District ${go}, ${km} km from the first move, picked because all three checks show up here.`,
        show: base,
      },
      {
        caption: `The ${whole(border.length)} outlined blocks are on that border: District ${gd} blocks touching District ${go}, and District ${go} blocks touching District ${gd}. Each could move to the other side.`,
        show: base,
        set: mark(border, 'kept'),
      },
      {
        caption: `A block may move only if it has people. ${none.length === 1 ? '1 of them has' : `${whole(none.length)} of them have`} no people.`,
        show: base,
        set: mark(none, 'out'),
      },
      { caption: widenText, show: base, set: mark(widen, 'out') },
      { caption: splitText, show: [...base, ...ids(pins)], set: mark(split, 'out') },
      {
        caption: `That leaves ${plural(ok.length, 'allowed move', 'allowed moves')} here${intoOther ? `, all into District ${go}` : ''}. Along District ${gd}'s whole border, ${whole(allowedAll)} of ${whole(cands.length)} moves are allowed.`,
        show: base,
        set: mark(ok, 'hot'),
      },
    ],
  };
}

/** balance.score: the allowed moves near the first move, their scores, and the move made. */
export async function scoreCase(ctx: ExtractContext): Promise<RuleCase> {
  const run = await balanceRun(ctx, ABBR);
  const first = run.rounds[0]!;
  const move = run.result.moves[0];
  if (!move) throw new DataError(`${run.abbr}: balancing made no move`);
  const { ideal } = run.out.metrics;
  const pops = popsBefore(run.out, 0);
  const a = pops[move.from]! - ideal, b = pops[move.to]! - ideal, p = move.pop;
  if (2 * p * (a - b - p) !== move.gain) throw new DataError(`${run.abbr}: 2 × p × (a − b − p) is not the gain of move 1`);
  const ranked = first.candidates.filter((c) => c.allowed);
  if (ranked[0]?.block !== move.block) throw new DataError(`${run.abbr}: move 1 is not the best allowed move of its round`);

  const MAP_H = 150;
  const around = nearestTo(run, move.block, WINDOW);
  const win = windowOf(run, around, MAP_H);
  const shown = new Set(around);
  // The allowed moves in view, best first as the generator ranked them.
  const here = ranked.filter((c) => shown.has(c.block));
  if (here.some((c) => c.from !== move.from || c.to !== move.to)) throw new DataError(`${run.abbr}: an allowed move in view is not between Districts ${move.from + 1} and ${move.to + 1}`);
  const blockSet = new Set(here.map((c) => c.block));
  if (blockSet.size !== here.length) throw new DataError(`${run.abbr}: a block in view has two allowed moves`);
  const tied = here.filter((c) => here.some((o) => o !== c && o.gain === c.gain));
  const tieGain = tied[0]?.gain;
  const tie = tied.filter((c) => c.gain === tieGain);
  const nextBest = ranked[1];
  const mark = (bs: readonly number[], v: string): Record<string, string> => Object.fromEntries(bs.map((x) => [win.idOf(x), v]));
  const kept = mark(here.map((c) => c.block), 'kept');

  const [gd, rd] = [move.from + 1, move.to + 1];
  const name = nameOf(run.abbr);
  const sign = (v: number): string => `${people(Math.abs(v))} ${v < 0 ? 'under' : 'over'}`;
  const formula = `2 × ${whole(p)} × (${people(a)} − ${people(b)} − ${whole(p)}) = ${whole(move.gain)}`;
  const moved: RuleBlock = { ...win.blocks.find((x) => x.id === win.idOf(move.block))!, id: 'moved', district: rd };
  const blocks = [...win.blocks, moved];
  const labels: Label[] = [
    { id: 'gd', x: 80, y: 168, text: `District ${gd}: ${whole(pops[move.from]!)}` },
    { id: 'rd', x: 240, y: 168, text: `District ${rd}: ${whole(pops[move.to]!)}` },
    { id: 'gd-after', x: 80, y: 168, text: `District ${gd}: ${whole(pops[move.from]! - p)}` },
    { id: 'rd-after', x: 240, y: 168, text: `District ${rd}: ${whole(pops[move.to]! + p)}` },
    { id: 'sum', x: W / 2, y: 188, text: formula, tag: 'sum' },
  ];
  const B = ids(win.blocks);
  const before = [...B, 'gd', 'rd'];
  const steps: RuleCase['steps'] = [
    {
      caption: `In ${name}, District ${gd} is ${sign(a)} the ideal of ${people(ideal)} and District ${rd} is ${sign(b)}. These are the ${whole(around.length)} blocks nearest the block that moves first.`,
      show: before,
    },
    {
      caption: `The ${plural(here.length, 'outlined block', 'outlined blocks')} may move from District ${gd} into District ${rd}. Each move is scored by how much it lowers the sum of the squared differences from the ideal.`,
      show: before,
      set: kept,
    },
  ];
  if (tie.length > 1) {
    const [w0, w1] = tie as [RoundCandidate, RoundCandidate, ...RoundCandidate[]];
    if (w0.border === undefined || w1.border === undefined) throw new DataError(`${run.abbr}: a ranked move has no border change`);
    if (w0.border > w1.border || (w0.border === w1.border && w0.block > w1.block)) throw new DataError(`${run.abbr}: the tied moves are not ranked by border, then GEOID order`);
    const [g0, g1] = [run.sb.blocks[w0.block]!.geoid, run.sb.blocks[w1.block]!.geoid];
    /** Meters of border change, one decimal and no trailing zero. */
    const meters = (v: number): string => `${Number(Math.abs(v).toFixed(1))} m`;
    const effect = (v: number): string => (v < 0 ? `shortens the border by ${meters(v)}` : v > 0 ? `adds ${meters(v)} of border` : 'leaves the border as it is');
    const tieWords = w0.border < w1.border
      ? `A tie goes to the move that leaves the shorter border. Moving ${g0} ${effect(w0.border)}, while moving ${g1} ${effect(w1.border)}, so ${g0} ranks ahead.`
      : `A tie goes to the move that leaves the shorter border, and these leave the same. Then the block that comes first in GEOID order, ${g0}, ranks ahead.`;
    steps.push({
      caption: `Of these, ${whole(tie.length)} tie at ${whole(tieGain!)}. ${tieWords}`,
      show: before,
      set: { ...kept, ...mark(tie.map((c) => c.block), 'hot') },
    });
  }
  steps.push(
    {
      caption: `The best is this block of ${plural(p, 'person', 'people')}: ${formula}. The next best allowed move anywhere on District ${gd}'s border scores ${whole(nextBest?.gain ?? 0)}.`,
      show: [...before, 'sum'],
      set: { ...kept, ...mark([move.block], 'hot') },
    },
    {
      caption: `So it moves into District ${rd}. District ${gd} now has ${whole(pops[move.from]! - p)} people and District ${rd} has ${whole(pops[move.to]! + p)}, and the sum falls by exactly ${whole(move.gain)}.`,
      show: [...B, 'moved', 'gd-after', 'rd-after', 'sum'],
    },
  );
  if (!nextBest) throw new DataError(`${run.abbr}: move 1 was the only allowed move`);
  return {
    id: 'balance.score',
    state: run.abbr,
    stateName: name,
    source: { move: 1 },
    link: { state: run.abbr, move: 1 },
    view: { w: W, h: 196 },
    blocks,
    labels,
    steps,
  };
}

/** The first round of a state's pass that tried more than one district and then made a move, as a 0-based move index. */
const firstRetry = (run: BalanceRun): number => run.rounds.findIndex((r, i) => r.tried.length > 1 && i < run.result.moves.length);

/** balance.next-furthest: the furthest district has no allowed move, so the next furthest is tried; after a move the pass starts again. */
export async function nextFurthestCase(ctx: ExtractContext): Promise<RuleCase> {
  const order = [ABBR, ...generatedStates(ctx.cfg.outDir).filter((s) => s !== ABBR)];
  let run: BalanceRun | undefined, k = -1;
  for (const abbr of order) {
    const r = await balanceRun(ctx, abbr);
    k = firstRetry(r);
    if (k >= 0) { run = r; break; }
  }
  if (!run) {
    const caption = 'In every state with a map, the furthest district always had an allowed move, so the pass never had to try the next furthest.';
    return { id: 'balance.next-furthest', state: ABBR, stateName: nameOf(ABBR), source: {}, link: { state: ABBR }, view: { w: W, h: 180 }, missing: 'no state ever tried a second district', steps: [{ caption, show: [] }] };
  }
  const round = run.rounds[k]!, after = run.rounds[k + 1]!;
  const [f, next] = [round.tried[0]!, round.tried[round.tried.length - 1]!];
  const mine = round.candidates.filter((c) => c.district === f);
  if (mine.some((c) => c.allowed)) throw new DataError(`${run.abbr}: District ${f + 1} had an allowed move in round ${k + 1}`);
  const { ideal } = run.out.metrics;
  const pops = popsBefore(run.out, k), popsNext = popsBefore(run.out, k + 1);
  const devs = pops.map((x) => x - ideal), devsNext = popsNext.map((x) => x - ideal);
  const n = pops.length;
  const move = run.out.balance.moves[k]!;
  const moveNo = k + 1;

  // Why every move on its border fails: each neighbor's gap, and the smallest populated block that could cross it.
  const under = devs[f]! < 0;
  const neighbors = [...new Set(mine.map((c) => (c.from === f ? c.to : c.from)))].sort((x, y) => x - y);
  const gaps = neighbors.map((e) => Math.abs(pops[e]! - pops[f]!));
  const smallest = neighbors.map((e) => {
    const crossing = mine.filter((c) => (under ? c.from === e && c.to === f : c.from === f && c.to === e)).map((c) => run!.sb.blocks[c.block]!.pop).filter((x) => x > 0);
    return crossing.length ? Math.min(...crossing) : 0;
  });
  neighbors.forEach((e, i) => {
    if ((under ? pops[e]! < pops[f]! : pops[e]! > pops[f]!) || (smallest[i]! > 0 && smallest[i]! < gaps[i]!)) {
      throw new DataError(`${run!.abbr}: District ${e + 1}'s border with District ${f + 1} does not explain why no move was allowed`);
    }
  });
  const count = (r: string): number => mine.filter((c) => c.reason === r).length;
  const [noPeople, widens, splits] = [count('no-people'), count('widens'), count('disconnects')];

  // Districts as far from the ideal as the one tried next, besides it: a tie goes to the district whose first block comes first.
  const far = (i: number): number => Math.abs(devs[i]!);
  const tie = devs.map((_, i) => i).filter((i) => i !== f && far(i) === far(next));
  const othersFirst = round.tried.slice(1, -1);
  if (othersFirst.length) throw new DataError(`${run.abbr}: round ${moveNo} tried more than two districts; the panel shows two`);
  const allowedNext = round.candidates.filter((c) => c.district === next && c.allowed).length;
  const name = nameOf(run.abbr);
  const D = (i: number): string => `District ${i + 1}`;
  /** "District 2" or "Districts 2, 3 and 5". */
  const Ds = (is: readonly number[]): string => (is.length === 1 ? D(is[0]!) : `Districts ${list(is.map((i) => String(i + 1)))}`);
  const side = (v: number): string => `${people(Math.abs(v))} ${v < 0 ? 'under' : 'over'}`;
  const worst = devs.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  const toWord = move.from - 1 === next ? `out of ${D(next)} into District ${move.to}` : `into ${D(next)} from District ${move.from}`;

  // Each district's first block just before move k, from the plan with the first k moves made.
  const assigned = Int32Array.from(run.input);
  const blockOf = new Map(run.sb.blocks.map((b, i) => [b.geoid, i] as const));
  for (const m of run.result.moves.slice(0, k)) assigned[blockOf.get(m.geoid)!] = m.to;
  const firsts = firstBlocks(assigned, n);

  const marks: Record<string, number[]> = { furthest: [f], border: neighbors, runnerUp: [f], winner: [next] };
  if (tie.length > 1 || (tie.length === 1 && tie[0] !== next)) marks.tie = [...new Set([next, ...tie])].sort((x, y) => x - y);
  if (marks.tie && marks.tie.some((i) => firsts[i]! < firsts[next]!)) throw new DataError(`${run.abbr}: round ${moveNo} tried a district whose first block is not first among the districts equally far`);
  const hasNextMove = k + 1 < run.result.moves.length;
  const [f2, next2] = [after.tried[0]!, after.tried[after.tried.length - 1]!];
  if (hasNextMove) { marks.again = [n + f2]; if (next2 !== f2) marks.next = [n + next2]; }
  const chart = ['chart', 'g1', 'g2'];
  const held = [...chart, 'chart-furthest', 'chart-runnerUp'];
  const tieWords = marks.tie
    ? `${Ds(marks.tie)} are each ${side(devs[next]!)}, and ${D(next)}, whose first block comes first in GEOID order, goes first.`
    : `That is ${D(next)}, ${side(devs[next]!)}.`;
  const lastCaption = !hasNextMove
    ? `After that move no district has an allowed move, so the pass stops.`
    : f2 === f && next2 !== f2
      ? `After every move the pass starts again from the furthest district. Before move ${moveNo + 1}, that is ${D(f)} again, ${side(devsNext[f]!)}, still with no allowed move, so ${D(next2)}, the next furthest, makes move ${moveNo + 1}.`
      : `After every move the pass starts again from the furthest district. Before move ${moveNo + 1}, that is ${D(f2)}, ${side(devsNext[f2]!)}, and it makes move ${moveNo + 1}.`;
  const reasons = [`${whole(noPeople)} ${noPeople === 1 ? 'is a block' : 'are blocks'} with no people`, `${whole(widens)} would widen a gap`];
  if (splits) reasons.push(`${whole(splits)} would split a district`);
  const steps: RuleCase['steps'] = [
    {
      caption: `Each bar is a district's distance from ${name}'s ideal of ${people(ideal)}, before move ${moveNo} (left) and move ${moveNo + 1} (right). Before move ${moveNo}, ${D(f)} is furthest, ${side(devs[f]!)}, so it is tried first.`,
      show: [...chart, 'chart-furthest'],
    },
    {
      caption: `None of the ${whole(mine.length)} moves on its border is allowed: ${list(reasons)}.`,
      show: held,
    },
    {
      caption: `${Ds(neighbors)} border it, ${under ? 'larger' : 'smaller'} by ${list(gaps.map((g) => whole(g)))} people. A move narrows a gap only if it carries fewer people than the gap, but the smallest blocks with people that could cross ${under ? 'into' : 'out of'} it hold ${list(smallest.map((x) => whole(x)))}.`,
      show: [...held, 'chart-border'],
    },
    {
      caption: `So the pass tries the next furthest district. ${tieWords}`,
      show: [...held, ...(marks.tie ? ['chart-tie'] : ['chart-winner'])],
    },
    {
      caption: `${D(next)} has ${plural(allowedNext, 'allowed move', 'allowed moves')}. The best moves ${plural(move.pop, 'person', 'people')} ${toWord}: that is move ${moveNo}.`,
      show: [...held, 'chart-winner'],
    },
    {
      caption: lastCaption,
      show: [...held, 'chart-winner', ...(marks.again ? ['chart-again'] : []), ...(marks.next ? ['chart-next'] : [])],
    },
  ];
  if (worst !== far(f)) throw new DataError(`${run.abbr}: District ${f + 1} is not the furthest before move ${moveNo}`);
  const labels: Label[] = [
    { id: 'g1', x: 84, y: 11, text: `before move ${moveNo}` },
    { id: 'g2', x: 236, y: 11, text: `before move ${moveNo + 1}` },
  ];
  return {
    id: 'balance.next-furthest',
    state: run.abbr,
    stateName: name,
    source: { move: moveNo },
    link: { state: run.abbr, move: moveNo },
    view: { w: W, h: 180 },
    labels,
    steps,
    chart: { kind: 'bars', values: [...devs, ...devsNext], labels: [...devs, ...devsNext].map((_, i) => String((i % n) + 1)), marks },
  };
}

export const balanceCases: readonly CaseBuilder[] = [allowedCase, scoreCase, nextFurthestCase];
