import { boundarySegments, forEachEdge, type Block, type BlockPolygons } from '../../../entities/census-block/index.js';
import {
  generatedStates, loadCutStats, loadMetricsIfPresent, numberField, projectWindow, simplifyRing,
  type CaseBuilder, type ExtractContext, type RuleCase,
} from '../../../features/rule-examples/index.js';
import type { CandidateTrace, CandidateTraceRequest, CutResult, TraceGroup, TraceSweep } from '../../../features/splitline/index.js';
import { DataError } from '../../../shared/errors/index.js';
import { greatCircleDistance, type LonLat } from '../../../shared/geo/index.js';
import { blockList, blockPanel, guideLines, nearest, ranks, type BlockPanel } from './cut.js';
import { clip, dot, fit, nameOf, people, round1, stateOutline, whole, type P } from './panel.js';
import { cutTrace, type CutTrace } from './trace.js';

type Line = NonNullable<RuleCase['lines']>[number];
type Label = NonNullable<RuleCase['labels']>[number];
type RuleBlock = NonNullable<RuleCase['blocks']>[number];

const W = 320;
/** Blocks shown around a group, besides the group itself. */
const WINDOW = 20;
/** The traced stray panels use Colorado, whose cuts are re-run on the census blocks. */
const ABBR = 'CO';

const ids = (xs: readonly { id: string }[]): string[] => xs.map((x) => x.id);
const sideWord = (s: 0 | 1): string => (s === 0 ? 'first' : 'second');
const sideState = (s: 0 | 1): string => (s === 0 ? 'low' : 'high');
const plural = (n: number, one: string, many: string): string => `${whole(n)} ${n === 1 ? one : many}`;
/** An angle for display: one decimal, no trailing zero. */
const deg = (angle: number): string => `${Number(angle.toFixed(1))}°`;
const km = (m: number): string => (m / 1000).toFixed(1);

/** Area of a closed ring (no repeated closing point), in its own units. */
const ringArea = (ring: readonly P[]): number => {
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i]!, [x2, y2] = ring[(i + 1) % ring.length]!;
    s += x1 * y2 - x2 * y1;
  }
  return Math.abs(s) / 2;
};

function missingCase(id: string, abbr: string, why: string, caption: string): RuleCase {
  return { id, state: abbr, stateName: nameOf(abbr), source: {}, link: { state: abbr }, view: { w: W, h: 200 }, missing: why, steps: [{ caption, show: [] }] };
}

/** A range of directions the generator passed over because its sides were not each connected (see unresolvedLines). */
interface SkippedRange { readonly lowSeats: number; readonly fromDeg: number; readonly toDeg: number }

/** The passed-over ranges a cut's search reports, or undefined when the engine does not report them. */
const skippedRangesOf = (r: CutResult): readonly SkippedRange[] | undefined => (r as { skippedRanges?: readonly SkippedRange[] }).skippedRanges;

/** Cuts looked at, and passed-over lines traced per cut, when searching for unresolved lines. */
const SKIP_CUTS = 6;
const SKIP_LINES = 12;

export interface UnresolvedCut {
  readonly t: CutTrace;
  /** The passed-over lines of the cut, traced at the middle of their ranges, in the generator's order. */
  readonly traces: readonly CandidateTrace[];
}

const unresolvedCache = new WeakMap<ExtractContext, Promise<UnresolvedCut[]>>();

/**
 * Lines the generator tried and passed over because their sides were not each connected, traced: for the cuts that
 * passed some over (cut-stats `skipped`), the fewest-ranges cuts first. Empty when no cut did, or when the cut
 * search does not report which ranges it passed over.
 */
export function unresolvedLines(ctx: ExtractContext): Promise<UnresolvedCut[]> {
  let hit = unresolvedCache.get(ctx);
  if (!hit) {
    hit = (async () => {
      const found: { abbr: string; order: number; ranges: number }[] = [];
      for (const abbr of generatedStates(ctx.cfg.outDir)) {
        const stats = await loadCutStats(ctx.cfg.outDir, abbr);
        for (const c of stats.cuts) if (numberField(c, 'skipped', abbr) >= 1) found.push({ abbr, order: c.order, ranges: numberField(c, 'candidateRanges', abbr) });
      }
      found.sort((p, q) => p.ranges - q.ranges || (p.abbr < q.abbr ? -1 : p.abbr > q.abbr ? 1 : p.order - q.order));
      const out: UnresolvedCut[] = [];
      for (const { abbr, order } of found.slice(0, SKIP_CUTS)) {
        const skipped = skippedRangesOf((await cutTrace(ctx, abbr, order)).result);
        if (!skipped) return [];
        if (!skipped.length) continue;
        const asks: CandidateTraceRequest[] = skipped.slice(0, SKIP_LINES).map((r) => ({ angleDeg: (r.fromDeg + r.toDeg) / 2, lowSeats: r.lowSeats }));
        const t = await cutTrace(ctx, abbr, order, asks);
        out.push({ t, traces: t.traces.filter((tr) => tr.unresolved) });
      }
      return out;
    })();
    unresolvedCache.set(ctx, hit);
  }
  return hit;
}

/** The line a cut used, traced, and how far its re-counts slid the guide line (meters). */
async function winning(ctx: ExtractContext, order: number): Promise<{ t: CutTrace; tr: CandidateTrace; shiftM: number }> {
  const t = await cutTrace(ctx, ABBR, order);
  return { t, tr: t.traces[0]!, shiftM: t.result.offsetShiftM };
}

export interface GroupPick {
  readonly t: CutTrace;
  readonly tr: CandidateTrace;
  /** How far the re-counts slid the cut's guide line, in meters. */
  readonly shiftM: number;
  /** 0-based pass in which the group was cut off. */
  readonly pass: number;
  readonly sweep: TraceSweep;
  readonly group: TraceGroup;
}

/**
 * The smallest group of two or more free blocks that a cut's first pass cuts off, matching `want`, over every cut
 * (ties go to the earlier cut, then the earlier sweep and group). Smallest, so the example stays readable and small.
 */
async function firstGroup(ctx: ExtractContext, want: (s: TraceSweep) => boolean): Promise<GroupPick | undefined> {
  const out = await ctx.state(ABBR);
  let best: GroupPick | undefined;
  for (const order of out.cutStats.cuts.map((c) => c.order).sort((a, b) => a - b)) {
    const { t, tr, shiftM } = await winning(ctx, order);
    for (const sweep of tr.passes[0]?.sweeps ?? []) {
      if (!want(sweep)) continue;
      for (const group of sweep.groups) {
        if (group.main || group.blocks.length < 2 || group.fixed.length > 0) continue;
        if (!best || group.blocks.length < best.group.blocks.length) best = { t, tr, shiftM, pass: 0, sweep, group };
      }
    }
  }
  return best;
}

/** which-stays and fixed: the first group of two or more blocks cut off in a first pass, on either side. */
export const cutOffGroup = (ctx: ExtractContext): Promise<GroupPick | undefined> => firstGroup(ctx, () => true);
/** recount: the first group of two or more blocks cut off from the second side in a first pass, so it is fixed on the first. */
export const fixedOnFirst = (ctx: ExtractContext): Promise<GroupPick | undefined> => firstGroup(ctx, (s) => s.side === 1);

/** The group's blocks plus the WINDOW piece blocks nearest the group's middle. */
function groupWindow(t: CutTrace, blocks: Int32Array): number[] {
  let x = 0, y = 0;
  for (const b of blocks) { x += t.blocks[b]!.point[0]; y += t.blocks[b]!.point[1]; }
  const inGroup = new Set(blocks);
  const around = nearest(t, [x / blocks.length, y / blocks.length], WINDOW + blocks.length).filter((b) => !inGroup.has(b)).slice(0, WINDOW);
  return [...blocks, ...around];
}

interface Window {
  readonly panel: BlockPanel;
  readonly blocks: RuleBlock[];
  /** Panel id of a block index. */
  readonly idOf: (b: number) => string;
  /** A data-state for every window block from a side function, with `hot` blocks marked instead. */
  readonly paint: (side: (b: number) => 0 | 1, hot?: readonly number[]) => Record<string, string>;
  /** One dot per block, at its internal point; ids `<prefix><i>`. */
  readonly pins: (bs: readonly number[], prefix: string) => Line[];
}

/** A block window; `prefix` keeps the ids of several windows in one panel apart. */
function windowOf(t: CutTrace, tr: CandidateTrace, around: number[], h: number, prefix = ''): Window {
  const panel = blockPanel(t, around, ranks(t, tr), h);
  // Largest first, so a block inside another's hole (an enclave, the usual stray) is drawn on top of it.
  const blocks = blockList(t, panel)
    .map((b) => ({ ...b, id: `${prefix}${b.id}` }))
    .sort((p, q) => ringArea(q.ring) - ringArea(p.ring) || (p.id < q.id ? -1 : 1));
  const at = new Map(panel.ids.map((b, i) => [b, `${prefix}b${i}`] as const));
  const idOf = (b: number): string => {
    const id = at.get(b);
    if (!id) throw new DataError(`${t.abbr}: block ${t.blocks[b]!.geoid} is not in the window`);
    return id;
  };
  return {
    panel, blocks, idOf,
    paint: (side, hot = []) => {
      const hotSet = new Set(hot);
      return Object.fromEntries(panel.ids.map((b) => [idOf(b), hotSet.has(b) ? 'hot' : sideState(side(b))]));
    },
    pins: (bs, prefix) => bs.map((b, i) => ({ id: `${prefix}${i}`, pts: dot(panel.project(t.blocks[b]!.point)), tag: 'point' })),
  };
}

/** Side of every block after pass p's walk (held blocks on their sides), before strays settle. */
function walkSide(tr: CandidateTrace, p: number): (b: number) => 0 | 1 {
  const low = new Set(tr.passes[p]!.walkLow);
  return (b) => (low.has(b) ? 0 : 1);
}
/** Side of every block once pass p's strays have settled. */
function settledSide(tr: CandidateTrace, p: number): (b: number) => 0 | 1 {
  const walk = walkSide(tr, p), moved = new Set(tr.passes[p]!.moved);
  return (b) => (moved.has(b) ? (1 - walk(b)) as 0 | 1 : walk(b));
}
function finalSide(tr: CandidateTrace): (b: number) => 0 | 1 {
  const low = new Set(tr.low);
  return (b) => (low.has(b) ? 0 : 1);
}

const MAP_H = 150;

/** strays.which-stays: a side's groups after a walk; the main body (most people, then blocks, then GEOID) stays, every other group crosses. */
export async function whichStaysCase(ctx: ExtractContext): Promise<RuleCase> {
  const pick = await cutOffGroup(ctx);
  if (!pick) return missingCase('strays.which-stays', ABBR, 'no group of two or more blocks is cut off in a first pass', `No cut in ${nameOf(ABBR)} cuts off a group of two or more blocks in its first pass.`);
  const { t, tr, sweep, group } = pick;
  const name = nameOf(t.abbr);
  const win = windowOf(t, tr, groupWindow(t, group.blocks), MAP_H);
  const guide = guideLines(tr.passes[0]!.spans, win.panel.project, MAP_H, 'guide');
  const main = sweep.groups.find((g) => g.main)!;
  const others = sweep.groups.filter((g) => !g.main);
  const crossed = others.reduce((n, g) => n + g.blocks.length, 0);
  const tie = others.some((g) => g.pop === main.pop);
  const s = sweep.side, o = (1 - s) as 0 | 1;
  const second = tr.passes[0]!.sweeps.find((x) => x.side === o);
  const secondOthers = second?.groups.filter((g) => !g.main) ?? [];
  const secondBlocks = secondOthers.reduce((n, g) => n + g.blocks.length, 0);
  const labels: Label[] = [
    { id: 'main', x: W / 2, y: 172, text: `main body: ${people(main.pop)} people, ${whole(main.blocks.length)} blocks` },
    { id: 'group', x: W / 2, y: 192, text: `this group: ${people(group.pop)} people, ${whole(group.blocks.length)} blocks`, tag: 'group' },
  ];
  const walk = win.paint(walkSide(tr, 0), [...group.blocks]);
  const moved = Object.fromEntries([...group.blocks].map((b) => [win.idOf(b), sideState(o)]));
  const base = [...ids(win.blocks), ...ids(guide)];
  return {
    id: 'strays.which-stays',
    state: t.abbr,
    stateName: name,
    source: { cut: t.cut.order, angleDeg: t.cut.angleDeg },
    link: { state: t.abbr, cut: t.cut.order },
    view: { w: W, h: 200 },
    blocks: win.blocks,
    lines: guide,
    labels,
    steps: [
      {
        caption: `Cut ${t.cut.order} in ${name}, just after its first walk, shaded by side. These ${whole(group.blocks.length)} blocks are on the ${sideWord(s)} side, but no edge links them to the rest of it.`,
        show: base,
        set: walk,
      },
      {
        caption: `After the walk the ${sideWord(s)} side is in ${whole(sweep.groups.length)} connected groups. Its main body is the group with the most people: ${people(main.pop)} in ${whole(main.blocks.length)} blocks.`,
        show: [...base, 'main'],
      },
      {
        caption: tie
          ? `This group has ${people(group.pop)} people in ${whole(group.blocks.length)} blocks. Another group ties the main body on people, so the block count, then the lowest GEOID, picks the main body.`
          : `This group has ${people(group.pop)} people in ${whole(group.blocks.length)} blocks, so it is not the main body. The block count, and then the lowest GEOID, would only decide a tie in people.`,
        show: [...base, 'main', 'group'],
      },
      {
        caption: `Every group other than the main body joins the ${sideWord(o)} side, the side around it: here ${plural(others.length, 'group', 'groups')} with ${plural(crossed, 'block', 'blocks')}, this one included.`,
        show: [...base, 'main', 'group'],
        set: moved,
      },
      {
        caption: secondOthers.length
          ? `Then the ${sideWord(o)} side is settled the same way, and ${plural(secondOthers.length, 'group', 'groups')} with ${plural(secondBlocks, 'block', 'blocks')} cut off from it ${secondOthers.length === 1 ? 'joins' : 'join'} the ${sideWord(s)} side. This repeats until nothing moves.`
          : `Then the ${sideWord(o)} side is settled the same way; nothing is cut off from it. This repeats until nothing moves.`,
        show: [...base, 'main', 'group'],
      },
    ],
  };
}

/** Walk rank of the last free first-side block in a pass, or -1 when there is none. */
function lastFreeLow(tr: CandidateTrace, rank: Int32Array, p: number): number {
  const pass = tr.passes[p]!;
  const held = new Set(pass.fixedLow);
  let last = -1;
  for (const b of pass.walkLow) if (!held.has(b) && rank[b]! > last) last = rank[b]!;
  return last;
}

export interface MixedPick {
  readonly t: CutTrace;
  readonly tr: CandidateTrace;
  /** 0-based pass and sweep in which the group was cut off. */
  readonly pass: number;
  readonly sweepAt: number;
  readonly sweep: TraceSweep;
  readonly group: TraceGroup;
  /** Side of every block just before and just after that sweep. */
  readonly before: (b: number) => 0 | 1;
  readonly after: (b: number) => 0 | 1;
  /** Blocks fixed when the sweep ran. */
  readonly held: ReadonlySet<number>;
}

/** Blocks that change side in one sweep: the free blocks of every group other than the main body. */
const sweepMoves = (sw: TraceSweep): number[] =>
  sw.groups.flatMap((g) => (g.main ? [] : [...g.blocks].filter((b) => !g.fixed.includes(b))));

const isMixed = (g: TraceGroup): boolean => !g.main && g.fixed.length > 0 && g.fixed.length < g.blocks.length;

/**
 * The smallest group, over the passed-over lines of the cuts that passed some over, that is cut off from its side's
 * main body while holding both fixed and free blocks (ties go to the first in the generator's order).
 */
export async function mixedGroup(ctx: ExtractContext): Promise<MixedPick | undefined> {
  let best: MixedPick | undefined;
  for (const one of await unresolvedLines(ctx)) {
   for (const tr of one.traces) {
    for (let p = 0; p < tr.passes.length; p++) {
      const pass = tr.passes[p]!;
      const sweepAt = pass.sweeps.findIndex((sw) => sw.groups.some(isMixed));
      if (sweepAt < 0) continue;
      // Sides as the sweeps leave them: a block flips in the sweep that moves it.
      const flips = pass.sweeps.map(sweepMoves);
      const all = new Set(flips.flat());
      if (all.size !== pass.moved.length || [...pass.moved].some((b) => !all.has(b))) throw new DataError(`${one.t.abbr} cut ${one.t.cut.order}: sweep moves do not add up to the pass's moved blocks`);
      const walk = walkSide(tr, p);
      const flippedBy = (n: number): Set<number> => new Set(flips.slice(0, n).flat());
      const sideAfter = (n: number) => {
        const f = flippedBy(n);
        return (b: number): 0 | 1 => (f.has(b) ? (1 - walk(b)) as 0 | 1 : walk(b));
      };
      const sweep = pass.sweeps[sweepAt]!;
      const group = sweep.groups.filter(isMixed).reduce((a, g) => (g.blocks.length < a.blocks.length ? g : a));
      if (best && group.blocks.length >= best.group.blocks.length) continue;
      const held = new Set([...pass.fixedLow, ...pass.fixedHigh, ...flippedBy(sweepAt)]);
      best = { t: one.t, tr, pass: p, sweepAt, sweep, group, before: sideAfter(sweepAt), after: sideAfter(sweepAt + 1), held };
    }
   }
  }
  return best;
}

/** strays.fixed: a group that moves is fixed at once and keeps its new side through the re-count. */
export async function fixedCase(ctx: ExtractContext): Promise<RuleCase> {
  const pick = await cutOffGroup(ctx);
  if (!pick) return missingCase('strays.fixed', ABBR, 'no group of two or more blocks is cut off in a first pass', `No cut in ${nameOf(ABBR)} cuts off a group of two or more blocks in its first pass.`);
  const { t, tr, sweep, group } = pick;
  const name = nameOf(t.abbr);
  const s = sweep.side, o = (1 - s) as 0 | 1;
  const next = tr.passes[1];
  if (!next) throw new DataError(`${t.abbr} cut ${t.cut.order}: strays moved but no re-count followed`);
  const win = windowOf(t, tr, groupWindow(t, group.blocks), MAP_H);
  const guide = guideLines(tr.passes[0]!.spans, win.panel.project, MAP_H, 'guide');
  const pins = win.pins([...group.blocks], 'pin');
  // Where the re-count's walk would put the group by position alone: before or after its last free first-side block.
  const rank = ranks(t, tr);
  const stop = lastFreeLow(tr, rank, 1);
  const byPosition = [...group.blocks].every((b) => rank[b]! <= stop) ? 0 : [...group.blocks].every((b) => rank[b]! > stop) ? 1 : undefined;
  const n = whole(group.blocks.length);
  const base = [...ids(win.blocks), ...ids(guide)];
  const withPins = [...base, ...ids(pins)];
  const final = finalSide(tr);
  if ([...group.blocks].some((b) => final(b) !== o)) throw new DataError(`${t.abbr} cut ${t.cut.order}: a fixed block did not end on its new side`);
  // A second window: a cut-off group holding fixed and free blocks, on another line tried for cut 1.
  const mix = await mixedGroup(ctx);
  const mixBlocks: RuleBlock[] = [], mixLines: Line[] = [];
  const mixSteps: RuleCase['steps'] = [];
  if (mix) {
    const g = [...mix.group.blocks];
    const fixedIn = g.filter((b) => mix.group.fixed.includes(b)), freeIn = g.filter((b) => !mix.group.fixed.includes(b));
    const mw = windowOf(mix.t, mix.tr, groupWindow(mix.t, mix.group.blocks), MAP_H, 'x');
    let mGuide: Line[] = [];
    try { mGuide = guideLines(mix.tr.passes[mix.pass]!.spans, mw.panel.project, MAP_H, 'xguide'); } catch { mGuide = []; }
    const mPins = mw.pins(mw.panel.ids.filter((b) => mix.held.has(b)), 'xpin');
    mixBlocks.push(...mw.blocks);
    mixLines.push(...mGuide, ...mPins);
    const sw = mix.sweep.side, so = (1 - sw) as 0 | 1;
    const mShow = [...ids(mw.blocks), ...ids(mGuide), ...ids(mPins)];
    const fb = (k: number): string => plural(k, 'block', 'blocks');
    mixSteps.push(
      {
        caption: `Fixed blocks count toward their side's groups like any other block. On a line tried for cut ${mix.t.cut.order} in ${nameOf(mix.t.abbr)} at ${deg(mix.tr.angleDeg)}, this group on the ${sideWord(sw)} side holds ${fb(fixedIn.length)} fixed there (dotted) and ${fb(freeIn.length)} still free, and it is cut off from the side's main body.`,
        show: mShow,
        set: mw.paint(mix.before, g),
      },
      {
        caption: `Its free ${freeIn.length === 1 ? 'block joins' : 'blocks join'} the ${sideWord(so)} side. Its fixed ${fixedIn.length === 1 ? 'block stays' : 'blocks stay'} on the ${sideWord(sw)} side, where ${fixedIn.length === 1 ? 'it was' : 'they were'} fixed.`,
        show: mShow,
        set: mw.paint(mix.after),
      },
    );
  } else {
    mixSteps.push({
      caption: `Fixed blocks count toward their side's groups like any other block. None of the passed-over lines traced for these examples cuts off a group holding both fixed and free blocks, so that case is not shown here.`,
      show: withPins,
    });
  }
  return {
    id: 'strays.fixed',
    state: t.abbr,
    stateName: name,
    source: { cut: t.cut.order, angleDeg: t.cut.angleDeg },
    link: { state: t.abbr, cut: t.cut.order },
    view: { w: W, h: 170 },
    blocks: [...win.blocks, ...mixBlocks],
    lines: [...guide, ...pins, ...mixLines],
    steps: [
      {
        caption: `Cut ${t.cut.order} in ${name}, just after its first walk. These ${n} blocks are on the ${sideWord(s)} side, cut off from the rest of it.`,
        show: base,
        set: win.paint(walkSide(tr, 0), [...group.blocks]),
      },
      {
        caption: `They join the ${sideWord(o)} side, the side around them, and are fixed to it at once. A dot marks each fixed block.`,
        show: withPins,
        set: win.paint(settledSide(tr, 0)),
      },
      {
        caption: byPosition === s
          ? `The re-count walks the free blocks again. By position these ${n} would fall on the ${sideWord(s)} side, but fixed blocks are left out of the walk, so they stay on the ${sideWord(o)} side.`
          : `The re-count walks the free blocks again. Fixed blocks are left out of the walk, so these ${n} stay on the ${sideWord(o)} side.`,
        show: withPins,
        set: win.paint(walkSide(tr, 1)),
      },
      {
        caption: `No later pass can move them either. They end cut ${t.cut.order} on the ${sideWord(o)} side, where they were fixed.`,
        show: withPins,
        set: win.paint(final),
      },
      ...mixSteps,
    ],
  };
}

/** strays.recount: the re-count's target is the first side's share minus the people already fixed on it. */
export async function recountCase(ctx: ExtractContext): Promise<RuleCase> {
  const pick = await fixedOnFirst(ctx);
  if (!pick) return missingCase('strays.recount', ABBR, 'no group of two or more blocks moves onto the first side in a first pass', `No cut in ${nameOf(ABBR)} moves a group of two or more blocks onto the first side in its first pass.`);
  const { t, tr, shiftM, group } = pick;
  const name = nameOf(t.abbr);
  const next = tr.passes[1];
  if (!next) throw new DataError(`${t.abbr} cut ${t.cut.order}: strays moved but no re-count followed`);
  const H = 150, BAR_Y = 176;
  const win = windowOf(t, tr, groupWindow(t, group.blocks), H);
  const guide = guideLines(tr.passes[0]!.spans, win.panel.project, H, 'guide');
  const pins = win.pins([...group.blocks], 'pin');
  const fixed = Array.from(next.fixedLow).reduce((s, b) => s + t.blocks[b]!.pop, 0);
  const share = tr.share, target = next.target;
  if (fixed <= 0 || target !== share - fixed) throw new DataError(`${t.abbr} cut ${t.cut.order}: the re-count target is not the share less the fixed people`);
  const reach = fixed * 1.6;
  const x = (v: number): number => 16 + ((v - (share - reach)) / (2 * reach)) * (W - 32);
  const lines: Line[] = [
    ...guide,
    ...pins,
    { id: 'track', pts: [[16, BAR_Y], [W - 16, BAR_Y]], tag: 'track' },
    { id: 'fill', pts: [[16, BAR_Y], round1([x(share), BAR_Y])], tag: 'fill' },
    { id: 'mark', pts: [round1([x(share), BAR_Y - 9]), round1([x(share), BAR_Y + 9])], tag: 'mark' },
  ];
  const labels: Label[] = [
    { id: 'share', x: Math.round(x(share)), y: BAR_Y - 14, text: `share ${people(share)}`, tag: 'share' },
    { id: 'fixed', x: W / 2, y: 214, text: `fixed on the first side ${people(fixed)}` },
    { id: 'target', x: Math.round(x(target)), y: BAR_Y + 22, text: `target ${people(target)}` },
  ];
  const elsewhere = next.fixedLow.length - group.blocks.length;
  const shift = Math.round(shiftM);
  const base = [...ids(win.blocks), ...ids(guide), ...ids(pins)];
  const bar = ['track', 'fill', 'mark', 'share'];
  return {
    id: 'strays.recount',
    state: t.abbr,
    stateName: name,
    source: { cut: t.cut.order, angleDeg: t.cut.angleDeg },
    link: { state: t.abbr, cut: t.cut.order },
    view: { w: W, h: 222 },
    blocks: win.blocks,
    lines,
    labels,
    steps: [
      {
        caption: `Cut ${t.cut.order} in ${name}, just after its first walk. These ${whole(group.blocks.length)} blocks are on the second side, cut off from the rest of it.`,
        show: [...ids(win.blocks), ...ids(guide)],
        set: win.paint(walkSide(tr, 0), [...group.blocks]),
      },
      {
        caption: elsewhere > 0
          ? `They join the first side and are fixed there with their ${people(group.pop)} people. With ${plural(elsewhere, 'more block', 'more blocks')} fixed elsewhere, ${people(fixed)} people are fixed on the first side.`
          : `They join the first side and are fixed there with their ${people(group.pop)} people, the only people fixed on the first side.`,
        show: base,
        set: win.paint(settledSide(tr, 0)),
      },
      {
        caption: `The first side's share is ${people(share)} people. The ${people(fixed)} fixed people already count on it.`,
        show: [...base, ...bar, 'fixed'],
      },
      {
        caption: `So the re-count walks the free blocks only, in the same order, toward ${people(share)} minus ${people(fixed)}: a target of ${people(target)}.`,
        show: [...base, ...bar, 'fixed', 'target'],
        tween: [{ id: 'fill', to: [[16, BAR_Y], round1([x(target), BAR_Y])] }],
      },
      {
        caption: `The walk stops by the same rule, and the guide line moves to between the last free block of the first side and the first free block of the second: here ${shift === 0 ? 'by less than a meter' : `by ${plural(shift < 0 ? -shift : shift, 'meter', 'meters')}`}.`,
        show: [...base, ...bar, 'fixed', 'target'],
        set: win.paint(walkSide(tr, 1)),
      },
    ],
  };
}

/** strays.ends: the line chosen for the Colorado cut that settled in the most passes, the blocks each pass moves, and the pass that moves none. */
export async function endsTrace(ctx: ExtractContext) {
  const out = await ctx.state(ABBR);
  const most = Math.max(...out.cutStats.cuts.map((c) => numberField(c, 'iterations', ABBR)));
  const cut = out.cutStats.cuts.filter((c) => numberField(c, 'iterations', ABBR) === most).sort((p, q) => p.order - q.order)[0];
  if (!cut) throw new DataError(`${ABBR}: no cuts in cut-stats.json`);
  const { t, tr, shiftM } = await winning(ctx, cut.order);
  return { t, tr, shiftM };
}

/** Blocks of `bs` within `m` meters of the one with the most such neighbors (lowest block index on a tie). */
function cluster(t: CutTrace, bs: readonly number[], m: number): number[] {
  let best: number[] = [];
  for (const a of [...bs].sort((p, q) => p - q)) {
    const near = bs.filter((b) => greatCircleDistance(t.blocks[a]!.point, t.blocks[b]!.point) <= m);
    if (near.length > best.length) best = near;
  }
  return [...best].sort((p, q) => p - q);
}

/** How far apart one pass's moved blocks may be and still be drawn in one close-up. */
const CLUSTER_M = 2000;

export async function endsCase(ctx: ExtractContext): Promise<RuleCase> {
  const { t, tr, shiftM } = await endsTrace(ctx);
  const name = nameOf(t.abbr);
  const n = tr.passes.length;
  if (n < 3 || n > 6) throw new DataError(`${t.abbr} cut ${t.cut.order}: the line with the most passes has ${n}, outside the 3 to 6 a panel shows`);
  if (tr.passes.at(-1)!.moved.length !== 0) throw new DataError(`${t.abbr} cut ${t.cut.order}: the last pass moved blocks`);
  const outline = await stateOutline(ctx.cfg.rawDir, t.abbr, 120);
  const proj = (p: LonLat) => t.split.proj.forward(p);
  const H = 204, MAP_H = 176;
  const toPanel = fit(outline.map(proj), W, MAP_H, 10);
  const at = (p: LonLat): P => toPanel(proj(p));
  const guide: Line[] = tr.passes.at(-1)!.spans.map(([a, b], i) => ({ id: i ? `line-${i}` : 'line', pts: [round1(at(a)), round1(at(b))], tag: 'guide' }));
  // The overview: every block that moves in any pass, as a dot on the state.
  const dots: Line[][] = tr.passes.map((p, i) => Array.from(p.moved, (b, j) => ({ id: `m${i + 1}-${j}`, pts: dot(at(t.blocks[b]!.point)), tag: 'point' })));
  const blocks: RuleBlock[] = [];
  const lines: Line[] = [{ id: 'outline', pts: [...outline, outline[0]!].map((p) => round1(at(p))), tag: 'outline' }, ...guide, ...dots.flat()];
  // Up close, one window per pass that moves blocks: a cluster of that pass's moved blocks and the blocks around it.
  const close: { show: string[]; set: Record<string, string>; here: number; win: Window; guide: Line[]; fixedAfter: Set<number>; prefix: string }[] = [];
  for (let p = 0; p < n - 1; p++) {
    const pass = tr.passes[p]!;
    const here = cluster(t, [...pass.moved], CLUSTER_M);
    const prefix = `p${p + 1}`;
    const win = windowOf(t, tr, groupWindow(t, Int32Array.from(here)), MAP_H, prefix);
    let g: Line[] = [];
    try { g = guideLines(pass.spans, win.panel.project, MAP_H, `${prefix}guide`); } catch { g = []; }
    const held = new Set([...pass.fixedLow, ...pass.fixedHigh]);
    const pins = win.pins(win.panel.ids.filter((b) => held.has(b)), `${prefix}pin`);
    blocks.push(...win.blocks);
    lines.push(...g, ...pins);
    close.push({
      show: [...ids(win.blocks), ...ids(g), ...ids(pins)], set: win.paint(walkSide(tr, p), here), here: here.length, win, guide: g,
      fixedAfter: new Set([...held, ...pass.moved]), prefix,
    });
  }
  // The last pass: the last close-up again, settled, with a dot on every block now fixed.
  const last = close.at(-1)!;
  const lastPins = last.win.pins(last.win.panel.ids.filter((b) => last.fixedAfter.has(b)), `${last.prefix}end`);
  lines.push(...lastPins);
  let fixed = 0;
  const labels: Label[] = tr.passes.map((p, i) => {
    fixed += p.moved.length;
    return { id: `count${i + 1}`, x: W / 2, y: H - 6, text: `pass ${i + 1}: ${whole(p.moved.length)} moved, ${whole(fixed)} fixed in all` };
  });
  const shift = Math.round(shiftM);
  const m = t.members.length;
  const captionOf = (i: number): string => {
    const moved = tr.passes[i]!.moved.length;
    if (i === n - 1) {
      return `Pass ${n} moves no free block, so it ends: ${whole(n)} walks, ${whole(fixed)} fixed blocks, and the line slid ${shift === 0 ? 'less than a meter' : plural(shift < 0 ? -shift : shift, 'meter', 'meters')} in all. A piece of ${whole(m)} blocks could need at most ${whole(m)} walks.`;
    }
    const here = close[i]!.here;
    const where = here === moved ? `${moved === 1 ? 'It is' : 'They are'} highlighted here, close up.` : `${here === 1 ? '1 of them is' : `${whole(here)} of them are`} highlighted here, close up.`;
    if (i === 0) return `Pass 1. After the walk, ${plural(moved, 'block is', 'blocks are')} cut off from their side and ${moved === 1 ? 'moves' : 'move'}, each fixed at once. ${where}`;
    return `Pass ${i + 1}. The re-count walks the free blocks again, and ${plural(moved, 'more block is', 'more blocks are')} cut off. ${where} Dots mark blocks fixed earlier.`;
  };
  return {
    id: 'strays.ends',
    state: t.abbr,
    stateName: name,
    source: { cut: t.cut.order, angleDeg: tr.angleDeg },
    link: { state: t.abbr, cut: t.cut.order },
    view: { w: W, h: H },
    blocks,
    lines,
    labels,
    steps: [
      {
        caption: `The line chosen for cut ${t.cut.order} in ${name}, ${deg(tr.angleDeg)} from north-south. Its strays take ${whole(n)} passes to settle; each dot is a block that moves in one of them.`,
        show: ['outline', ...ids(guide), ...dots.flatMap(ids)],
      },
      ...tr.passes.map((_, i) => (i < n - 1
        ? { caption: captionOf(i), show: [...close[i]!.show, `count${i + 1}`], set: close[i]!.set }
        : {
          caption: captionOf(i),
          show: [...ids(last.win.blocks), ...ids(last.guide), ...ids(lastPins), `count${i + 1}`],
          set: last.win.paint(finalSide(tr)),
        })),
    ],
  };
}

/** strays.no-rejoin: the first passed-over line that leaves a fixed group cut off, and that group. */
export async function noRejoinTrace(ctx: ExtractContext) {
  for (const one of await unresolvedLines(ctx)) {
    for (const tr of one.traces) {
      const group = tr.passes.at(-1)!.sweeps.flatMap((sw) => sw.groups).find((g) => !g.main && g.fixed.length > 0);
      if (group) return { t: one.t, tr, group };
    }
  }
  return undefined;
}

export async function noRejoinCase(ctx: ExtractContext): Promise<RuleCase> {
  const pick = await noRejoinTrace(ctx);
  if (!pick) return missingCase('strays.no-rejoin', ABBR, 'no passed-over line leaves a fixed group cut off', 'None of the passed-over lines traced for these examples is left with a side in more than one piece after settling its strays, so no example is shown here.');
  const { t, tr, group } = pick;
  const name = nameOf(t.abbr);
  const n = tr.passes.length;
  const g = [...group.blocks];
  // The pass in which the group moved, and the sides it moved between.
  const pm = tr.passes.findIndex((p) => g.every((b) => p.moved.includes(b)));
  if (pm < 0) throw new DataError(`${t.abbr} cut ${t.cut.order}: the stranded group did not move in one pass`);
  const from = walkSide(tr, pm)(g[0]!), to = (1 - from) as 0 | 1;
  const win = windowOf(t, tr, groupWindow(t, group.blocks), MAP_H);
  const guide = guideLines(tr.passes[pm]!.spans, win.panel.project, MAP_H, 'guide');
  const after = settledSide(tr, pm), final = finalSide(tr);
  const fixedThen = new Set([...tr.passes[pm + 1]!.fixedLow, ...tr.passes[pm + 1]!.fixedHigh]);
  const pins = win.pins(win.panel.ids.filter((b) => fixedThen.has(b)), 'pin');
  const changed = win.panel.ids.filter((b) => !fixedThen.has(b) && after(b) !== final(b)).length;
  const nG = whole(g.length);
  const base = [...ids(win.blocks), ...ids(guide)];
  const withPins = [...base, ...ids(pins)];
  return {
    id: 'strays.no-rejoin',
    state: t.abbr,
    stateName: name,
    source: { cut: t.cut.order, angleDeg: tr.angleDeg },
    link: { state: t.abbr, cut: t.cut.order },
    view: { w: W, h: 160 },
    blocks: win.blocks,
    lines: [...guide, ...pins],
    steps: [
      {
        caption: `A line tried for cut ${t.cut.order} in ${name}, ${deg(tr.angleDeg)} from north-south. After ${pm === 0 ? 'its first walk' : `walk ${pm + 1}`}, these ${nG} blocks are on the ${sideWord(from)} side, cut off from it.`,
        show: base,
        set: win.paint(walkSide(tr, pm), g),
      },
      {
        caption: `They join the ${sideWord(to)} side, the side around them, and are fixed there. A dot marks each fixed block.`,
        show: withPins,
        set: win.paint(after),
      },
      {
        caption: changed > 0
          ? `After the re-count, ${plural(changed, 'free block', 'free blocks')} here ${changed === 1 ? 'is' : 'are'} on the other side, and these ${nG} are cut off from the ${sideWord(to)} side.`
          : `After the re-count, these ${nG} are cut off from the ${sideWord(to)} side again.`,
        show: withPins,
        set: win.paint(final),
      },
      {
        caption: `Pass ${n} moves no free block, and these ${nG} cannot move back: they are fixed. The ${sideWord(to)} side is left in more than one piece.`,
        show: withPins,
        set: { ...win.paint(final), ...Object.fromEntries(g.map((b) => [win.idOf(b), 'hot'])) },
      },
      {
        caption: `So this line's ${sideWord(to)} side is not one connected piece. It fails that check, and the next shortest line is considered.`,
        show: withPins,
        set: win.paint(final),
      },
    ],
  };
}

/** Join segments that share endpoints into polylines; closed loops repeat their first point at the end. */
function chain(segs: readonly (readonly [P, P])[], key: (p: P) => string): P[][] {
  const at = new Map<string, number[]>();
  segs.forEach(([a, b], i) => {
    for (const k of [key(a), key(b)]) { const l = at.get(k); if (l) l.push(i); else at.set(k, [i]); }
  });
  const used = new Uint8Array(segs.length);
  const out: P[][] = [];
  const extend = (line: P[]): void => {
    for (;;) {
      const end = line[line.length - 1]!, k = key(end);
      const i = (at.get(k) ?? []).find((j) => !used[j]);
      if (i === undefined) return;
      used[i] = 1;
      const [a, b] = segs[i]!;
      line.push(key(a) === k ? b : a);
    }
  };
  segs.forEach(([a, b], i) => {
    if (used[i]) return;
    used[i] = 1;
    const line: P[] = [a, b];
    extend(line);
    line.reverse();
    extend(line);
    out.push(line);
  });
  return out;
}

/** The first Colorado cut, by order, whose line leaves its piece and comes back (two or more spans inside the piece). */
async function leavingCut(ctx: ExtractContext): Promise<{ t: CutTrace; tr: CandidateTrace; spans: CandidateTrace['passes'][number]['spans'] }> {
  const out = await ctx.state(ABBR);
  for (const order of out.cutStats.cuts.map((c) => c.order).sort((a, b) => a - b)) {
    const t = await cutTrace(ctx, ABBR, order);
    const tr = t.traces[0]!;
    const spans = tr.passes.at(-1)!.spans;
    if (spans.length >= 2) return { t, tr, spans };
  }
  throw new DataError(`${ABBR}: no cut's line leaves its piece and comes back; the outline panel needs one that does`);
}

/** strays.outline: a cut's line leaves its piece and comes back, crossing the outline at every span end. */
export async function outlineCase(ctx: ExtractContext): Promise<RuleCase> {
  const { t, tr, spans } = await leavingCut(ctx);
  const name = nameOf(t.abbr);
  const proj = (p: LonLat): P => { const [x, y] = t.split.proj.forward(p); return [x, y]; };
  const segs = boundarySegments(t.topo, t.members);
  const lonlat: [P, P][] = [];
  for (let i = 0; i < segs.count; i++) lonlat.push([[segs.a[2 * i]!, segs.a[2 * i + 1]!], [segs.b[2 * i]!, segs.b[2 * i + 1]!]]);
  const fixedKey = (p: P): string => `${Math.round(p[0] * 1e7)},${Math.round(p[1] * 1e7)}`;
  const rings = chain(lonlat, fixedKey).map((r) => r.map(proj));
  const H = 200, MAP_H = 188, PAD = 10;
  const big = fit(rings.flat(), W, MAP_H, PAD);
  // Whole piece: closed rings in panel units, simplified, without specks.
  const outline: Line[] = [];
  for (const r of rings) {
    const ring = simplifyRing(r.slice(0, -1).map(big), 0.6).map(round1);
    if (ringArea(ring) < 4) continue;
    outline.push({ id: outline.length ? `outline-${outline.length}` : 'outline', pts: [...ring, ring[0]!], tag: 'outline' });
  }
  // Up close: a box around where the line leaves the piece and comes back.
  const gapA = spans[0]![1], gapB = spans[1]![0];
  const near = [gapA, gapB, spans[1]![1]].map(proj);
  const zx0 = Math.min(...near.map((p) => p[0])), zx1 = Math.max(...near.map((p) => p[0]));
  const zy0 = Math.min(...near.map((p) => p[1])), zy1 = Math.max(...near.map((p) => p[1]));
  const zp = Math.max(zx1 - zx0, zy1 - zy0) * 0.25;
  const zoom = fit([[zx0 - zp, zy0 - zp], [zx1 + zp, zy1 + zp]], W, MAP_H, PAD);
  const inside = (p: P): boolean => p[0] >= 0 && p[0] <= W && p[1] >= 0 && p[1] <= MAP_H;
  const zsegs: [P, P][] = [];
  for (const [a, b] of lonlat) {
    const c = clip(zoom(proj(a)), zoom(proj(b)), W, MAP_H);
    if (c) zsegs.push([round1(c[0]), round1(c[1])]);
  }
  const closeUp: Line[] = chain(zsegs.filter(([a, b]) => a[0] !== b[0] || a[1] !== b[1]), (p) => `${p[0]},${p[1]}`)
    .map((pts, i) => ({ id: `outline-z${i}`, pts, tag: 'outline' }));
  const cut: Line[] = spans.map(([a, b], i) => ({ id: i ? `cut-${i}` : 'cut', pts: [round1(big(proj(a))), round1(big(proj(b)))], tag: 'cut' }));
  const ends = spans.flatMap(([a, b]) => [a, b]);
  const crossings: Line[] = ends.map((p, i) => ({ id: `x${i}`, pts: dot(big(proj(p))), tag: 'crossing' }));
  const tween: { id: string; to: P[] }[] = [];
  const hideZoom: string[] = [...ids(outline)];
  spans.forEach(([a, b], i) => {
    const c = clip(zoom(proj(a)), zoom(proj(b)), W, MAP_H);
    if (c) tween.push({ id: cut[i]!.id, to: c.map(round1) });
    else hideZoom.push(cut[i]!.id);
  });
  ends.forEach((p, i) => {
    const z = zoom(proj(p));
    if (inside(z)) tween.push({ id: `x${i}`, to: dot(z) });
    else hideZoom.push(`x${i}`);
  });
  const gapM = greatCircleDistance(gapA, gapB);
  // The stretch of the line outside the piece, dashed, with its length beside it when close up.
  const gap: Line = { id: 'gap', pts: [round1(big(proj(gapA))), round1(big(proj(gapB)))], tag: 'guide' };
  const zGap = clip(zoom(proj(gapA)), zoom(proj(gapB)), W, MAP_H);
  if (!zGap) throw new DataError(`${ABBR} cut ${t.cut.order}: the stretch outside the piece misses the close-up`);
  tween.push({ id: 'gap', to: zGap.map(round1) });
  const zMid: P = [(zGap[0][0] + zGap[1][0]) / 2, (zGap[0][1] + zGap[1][1]) / 2];
  const labels: Label[] = [{
    id: 'outside', x: Math.round(zMid[0] > W / 2 ? zMid[0] - 70 : zMid[0] + 70), y: Math.round(zMid[1]), text: `${km(gapM)} km outside`, tag: 'length',
  }];
  const all = [...ids(outline), 'gap', ...ids(cut), ...ids(crossings)];
  const zoomed = [...ids(closeUp), 'gap', ...ids(cut), ...ids(crossings), 'outside'];
  return {
    id: 'strays.outline',
    state: t.abbr,
    stateName: name,
    source: { cut: t.cut.order, angleDeg: t.cut.angleDeg },
    link: { state: t.abbr, cut: t.cut.order },
    view: { w: W, h: H },
    lines: [...outline, ...closeUp, gap, ...cut, ...crossings],
    labels,
    steps: [
      { caption: `Cut ${t.cut.order} in ${name} splits this piece, with ${t.cut.seats} seats, into ${tr.lowSeats} and ${t.cut.seats - tr.lowSeats}. The outline is the edge of the piece's blocks.`, show: ids(outline) },
      { caption: `Its line runs here, ${deg(t.cut.angleDeg)} from north-south.`, show: [...ids(outline), ...ids(cut)] },
      { caption: `The line crosses the piece's outline ${whole(ends.length)} times, marked: it leaves the piece and comes back in. At this scale some of the marks sit almost on top of each other.`, show: all },
      {
        caption: `Up close: the line leaves the piece, runs ${km(gapM)} km outside it (dashed), and comes back in.`,
        show: zoomed,
        hide: hideZoom,
        tween,
      },
      { caption: 'That is allowed. A line may cross the piece\'s outline any number of times.', show: zoomed, hide: hideZoom },
    ],
  };
}

export interface CornerPair {
  readonly abbr: string;
  /** Block indices: a and b touch only at a corner, a < b, the first such pair in GEOID order; c shares an edge with a. */
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly vertex: LonLat;
}

/** The first pair of Colorado blocks, in GEOID order, that share a corner but no edge, and an edge neighbor of the first. */
export async function cornerPair(ctx: ExtractContext): Promise<CornerPair> {
  const { blocks, topo } = await ctx.blocks(ABBR);
  let total = 0;
  for (const b of blocks) for (const r of b.rings) total += r.length;
  const X = new Int32Array(total), Y = new Int32Array(total), B = new Int32Array(total);
  let n = 0;
  blocks.forEach((b, i) => {
    for (const r of b.rings) for (const p of r) { X[n] = Math.round(p[0] * 1e7); Y[n] = Math.round(p[1] * 1e7); B[n] = i; n++; }
  });
  const order = Int32Array.from({ length: n }, (_, i) => i).sort((p, q) => X[p]! - X[q]! || Y[p]! - Y[q]! || B[p]! - B[q]!);
  const adjacent = (u: number, v: number): boolean => topo.adjList.subarray(topo.adjOffsets[u]!, topo.adjOffsets[u + 1]!).includes(v);
  let best: [number, number, number] | undefined;
  for (let i = 0; i < n;) {
    const at = order[i]!;
    const here: number[] = [];
    let j = i;
    for (; j < n && X[order[j]!] === X[at] && Y[order[j]!] === Y[at]; j++) if (here.at(-1) !== B[order[j]!]) here.push(B[order[j]!]!);
    for (let p = 0; p < here.length; p++) {
      for (let q = p + 1; q < here.length; q++) {
        const u = here[p]!, v = here[q]!;
        if (!adjacent(u, v) && (!best || u < best[0] || (u === best[0] && v < best[1]))) best = [u, v, at];
      }
    }
    i = j;
  }
  if (!best) throw new DataError(`${ABBR}: no two blocks touch only at a corner`);
  const [a, b, at] = best;
  const vertex: LonLat = [X[at]! / 1e7, Y[at]! / 1e7];
  // The neighbor: the lowest-index block sharing an edge with a that also meets the corner, else any edge neighbor.
  const atCorner = new Set<number>();
  for (let i = 0; i < n; i++) if (X[i] === X[at] && Y[i] === Y[at]) atCorner.add(B[i]!);
  const neigh = Array.from(topo.adjList.subarray(topo.adjOffsets[a]!, topo.adjOffsets[a + 1]!)).filter((v) => v !== b).sort((p, q) => p - q);
  const c = neigh.find((v) => atCorner.has(v)) ?? neigh[0];
  if (c === undefined) throw new DataError(`${ABBR}: block ${blocks[a]!.geoid} has no edge neighbor`);
  return { abbr: ABBR, a, b, c, vertex };
}

/** Project a few whole blocks into a w by h panel; block ids are given. */
function fewBlocks(blocks: readonly Block[], picks: readonly (readonly [string, number])[], h: number) {
  const chosen = picks.map(([, b]) => blocks[b]!);
  const polys = new Map<string, BlockPolygons>(chosen.map((b) => [b.geoid, b.rings.map((r) => [r])]));
  const { project, rings } = projectWindow(chosen, polys, { w: W, h });
  const out: RuleBlock[] = picks.map(([id, b]) => {
    const ring = rings.get(blocks[b]!.geoid);
    if (!ring) throw new DataError(`block ${blocks[b]!.geoid} has no outline`);
    return { id, geoid: blocks[b]!.geoid, pop: blocks[b]!.pop, ring };
  });
  // Largest first, so a block inside another's hole is drawn on top of it.
  return { project, blocks: out.sort((p, q) => ringArea(q.ring) - ringArea(p.ring) || (p.id < q.id ? -1 : 1)) };
}

/** strays.connected: two blocks touching at one corner are not connected; sharing an edge is. */
export async function connectedCase(ctx: ExtractContext): Promise<RuleCase> {
  const { abbr, a, b, c, vertex } = await cornerPair(ctx);
  const { blocks, topo } = await ctx.blocks(abbr);
  const name = nameOf(abbr);
  const H = 180;
  const { project, blocks: shown } = fewBlocks(blocks, [['a', a], ['b', b], ['c', c]], H);
  const edges: Line[] = [];
  forEachEdge(topo, (p, q, bs) => {
    if (bs.includes(a) && bs.includes(c)) edges.push({ id: `e${edges.length}`, pts: [round1(project(p)), round1(project(q))], tag: 'border' });
  });
  if (!edges.length) throw new DataError(`${abbr}: blocks ${blocks[a]!.geoid} and ${blocks[c]!.geoid} share no edge`);
  const corner: Line = { id: 'corner', pts: dot(project(vertex)), tag: 'crossing' };
  return {
    id: 'strays.connected',
    state: abbr,
    stateName: name,
    source: {},
    link: { state: abbr },
    view: { w: W, h: H },
    blocks: shown,
    lines: [...edges, corner],
    steps: [
      {
        caption: `Two blocks in ${name}, the first pair in GEOID order that touch only at a corner: ${blocks[a]!.geoid} and ${blocks[b]!.geoid}.`,
        show: ['a', 'b'],
        set: { a: 'low', b: 'high' },
      },
      { caption: 'They meet at this single point and share no edge. Touching at a corner does not count, so these two are not connected.', show: ['a', 'b', 'corner'] },
      {
        caption: `This block, ${blocks[c]!.geoid}, shares an edge with the first one, marked along its length, so those two are connected.`,
        show: ['a', 'b', 'c', 'corner', ...ids(edges)],
        set: { c: 'low' },
      },
    ],
  };
}

export interface IslandPick {
  readonly abbr: string;
  /** Blocks of the island, by index. */
  readonly island: number[];
  readonly islandBlock: number;
  readonly mainBlock: number;
  /** Detached pieces in the state, one bridge each. */
  readonly bridges: number;
  readonly mainBody: Int32Array;
}

/**
 * The first generated state alphabetically with bridges, and of its bridges that reach the main body, the one with
 * the smallest island (fewest blocks, then the earlier bridge). The main body is the largest group of blocks joined
 * by shared edges alone.
 */
export async function islandBridge(ctx: ExtractContext): Promise<IslandPick | undefined> {
  let abbr: string | undefined;
  for (const s of generatedStates(ctx.cfg.outDir)) {
    // metrics.json carries a bridges count; the shared schema passes it through unnamed.
    const bridges = ((await loadMetricsIfPresent(ctx.cfg.outDir, s)) as Record<string, unknown> | undefined)?.bridges;
    if (typeof bridges === 'number' && bridges > 0) { abbr = s; break; }
  }
  if (!abbr) return undefined;
  const { topo } = await ctx.blocks(abbr);
  const pairKey = (u: number, v: number): string => (u < v ? `${u},${v}` : `${v},${u}`);
  const bridged = new Set(topo.bridges.map(([u, v]) => pairKey(u, v)));
  const comp = new Int32Array(topo.n).fill(-1);
  const members: number[][] = [];
  for (let s = 0; s < topo.n; s++) {
    if (comp[s] !== -1) continue;
    const id = members.length, list: number[] = [], stack = [s];
    comp[s] = id;
    while (stack.length) {
      const u = stack.pop()!;
      list.push(u);
      for (let k = topo.adjOffsets[u]!; k < topo.adjOffsets[u + 1]!; k++) {
        const v = topo.adjList[k]!;
        if (comp[v] === -1 && !bridged.has(pairKey(u, v))) { comp[v] = id; stack.push(v); }
      }
    }
    members.push(list);
  }
  let main = 0;
  for (let c = 1; c < members.length; c++) if (members[c]!.length > members[main]!.length) main = c;
  let pick: { island: number; islandBlock: number; mainBlock: number } | undefined;
  for (const [u, v] of topo.bridges) {
    const [isl, mb] = comp[u] === main ? [v, u] : comp[v] === main ? [u, v] : [-1, -1];
    if (isl < 0 || comp[isl] === main) continue;
    if (!pick || members[comp[isl]!]!.length < members[pick.island]!.length) pick = { island: comp[isl]!, islandBlock: isl, mainBlock: mb };
  }
  if (!pick) return undefined;
  return {
    abbr, island: [...members[pick.island]!].sort((p, q) => p - q), islandBlock: pick.islandBlock, mainBlock: pick.mainBlock,
    bridges: topo.bridges.length, mainBody: Int32Array.from(members[main]!),
  };
}

/** strays.islands: a detached piece of land linked to the main body, at the closest pair of internal points. */
export async function islandsCase(ctx: ExtractContext): Promise<RuleCase> {
  const pick = await islandBridge(ctx);
  if (!pick) return missingCase('strays.islands', ABBR, 'no generated state has detached land', 'None of the generated states has an island or other detached land, so there is no bridge to show.');
  const { abbr, island, islandBlock, mainBlock, bridges, mainBody } = pick;
  const { blocks } = await ctx.blocks(abbr);
  const name = nameOf(abbr);
  const at = blocks[mainBlock]!.point;
  const around = Array.from(mainBody, (b) => [b, greatCircleDistance(at, blocks[b]!.point)] as const)
    .sort((p, q) => p[1] - q[1] || p[0] - q[0]).slice(0, 8).map(([b]) => b);
  if (around[0] !== mainBlock) around.unshift(mainBlock);
  const H = 180;
  const { project, blocks: shown } = fewBlocks(blocks, [
    ...island.map((b, i) => [`i${i}`, b] as const),
    ...around.slice(0, 8).map((b, i) => [`m${i}`, b] as const),
  ], H);
  const I = island.map((_, i) => `i${i}`), M = around.slice(0, 8).map((_, i) => `m${i}`);
  const pi = project(blocks[islandBlock]!.point), pm = project(at);
  const distM = greatCircleDistance(blocks[islandBlock]!.point, at);
  const lines: Line[] = [
    { id: 'bridge', pts: [round1(pi), round1(pm)], tag: 'guide' },
    { id: 'pi', pts: dot(pi), tag: 'point' },
    { id: 'pm', pts: dot(pm), tag: 'point' },
  ];
  // The distance sits beside the bridge, off its middle at right angles, on the side with more room.
  const mid: P = [(pi[0] + pm[0]) / 2, (pi[1] + pm[1]) / 2];
  const len = Math.sqrt((pm[0] - pi[0]) * (pm[0] - pi[0]) + (pm[1] - pi[1]) * (pm[1] - pi[1])) || 1;
  let nx = -(pm[1] - pi[1]) / len, ny = (pm[0] - pi[0]) / len;
  if ((nx < 0 ? mid[0] : W - mid[0]) < 60) { nx = -nx; ny = -ny; }
  const labels: Label[] = [{
    id: 'dist', x: Math.round(Math.min(Math.max(mid[0] + nx * 40, 40), W - 40)), y: Math.round(Math.min(Math.max(mid[1] + ny * 40, 12), H - 4)),
    text: `${km(distM)} km`, tag: 'length',
  }];
  const paint = { ...Object.fromEntries(I.map((id) => [id, 'low'])), ...Object.fromEntries(M.map((id) => [id, 'high'])) };
  return {
    id: 'strays.islands',
    state: abbr,
    stateName: name,
    source: {},
    link: { state: abbr },
    view: { w: W, h: H },
    blocks: shown,
    lines,
    labels,
    steps: [
      {
        caption: `${name} has ${plural(bridges, 'piece', 'pieces')} of land that share no edge with the rest: islands and other detached land. This island is ${plural(island.length, 'block', 'blocks')}.`,
        show: I,
        set: paint,
      },
      {
        caption: `The nearest block of the main body is ${km(distM)} km away, measured between internal points.`,
        show: [...I, ...M, 'pi', 'pm'],
      },
      {
        caption: `The two blocks are joined as if they shared an edge, so the island counts as connected to the rest of ${name}.`,
        show: [...I, ...M, 'pi', 'pm', 'bridge', 'dist'],
      },
      {
        caption: `Detached land is connected one shortest link at a time, measured between internal points and often to another island, so ${name} can be cut like any other state.`,
        show: [...I, ...M, 'pi', 'pm', 'bridge', 'dist'],
      },
    ],
  };
}

/** The stray-piece panels (stage 3). */
export const strayCases: readonly CaseBuilder[] = [
  whichStaysCase, fixedCase, recountCase, endsCase, noRejoinCase, outlineCase, connectedCase, islandsCase,
];
