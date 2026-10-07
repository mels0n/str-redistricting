import { stateByAbbr } from '../../../shared/apportionment/index.js';
import { DataError } from '../../../shared/errors/index.js';
import type { ExtractContext } from '../context.js';
import { chosenCandidate } from '../load.js';
import type { RuleCase } from '../schema.js';

/** The state's full name from the apportionment table. */
function nameOf(abbr: string): string {
  const info = stateByAbbr(abbr);
  if (!info) throw new DataError(`unknown state: ${abbr}`);
  return info.name;
}
const VIEW = { w: 320, h: 180 };
const whole = (n: number): string => n.toLocaleString('en-US');
const twoDecimals = (n: number): string => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** cut.share: the first cut of a state gives the smaller side its seats' share of the people. */
export async function shareCase(ctx: ExtractContext): Promise<RuleCase> {
  const abbr = 'AL';
  const out = await ctx.state(abbr);
  const { population: pop, seats } = out.metrics;
  const cut = out.cutStats.cuts[0];
  if (!cut) throw new Error(`${abbr}: no cuts in cut-stats.json`);
  const low = chosenCandidate(out, 0).lowSeats;
  if (low === undefined) throw new DataError(abbr + ': candidates.json has no lowSeats column');
  const share = (pop * low) / cut.seats;
  return {
    id: 'cut.share',
    state: abbr,
    stateName: nameOf(abbr),
    source: { cut: cut.order, angleDeg: cut.angleDeg },
    link: { state: abbr, cut: cut.order },
    view: VIEW,
    labels: [
      { id: 'pop', x: 160, y: 60, text: `${whole(pop)} people` },
      { id: 'share', x: 160, y: 110, text: `${twoDecimals(share)} people`, tag: 'share' },
    ],
    steps: [
      { caption: `${nameOf(abbr)} has ${whole(pop)} people and ${seats} seats, so the first cut works on all ${seats}.`, show: ['pop'] },
      { caption: `The ${seats} seats split into ${low} and ${cut.seats - low}. The ${low}-seat side should hold ${low} of every ${seats} people.`, show: ['pop'] },
      { caption: `${whole(pop)} x ${low} / ${seats} = ${twoDecimals(share)}, the number of people the ${low}-seat side should hold.`, show: ['pop', 'share'] },
    ],
  };
}

/** balance.ideal: the ideal district size is rarely whole, so the targets are the two neighbouring whole numbers. */
export async function idealCase(ctx: ExtractContext): Promise<RuleCase> {
  const abbr = 'CO';
  const { metrics } = await ctx.state(abbr);
  const { population: pop, seats, ideal } = metrics;
  const floor = Math.floor(ideal), ceil = Math.ceil(ideal);
  const onTarget = metrics.districts.flatMap((d, i) => (d.pop === floor || d.pop === ceil ? [i] : []));
  return {
    id: 'balance.ideal',
    state: abbr,
    stateName: nameOf(abbr),
    source: {},
    link: { state: abbr },
    view: VIEW,
    labels: [
      { id: 'ideal', x: 160, y: 11, text: `${whole(pop)} / ${seats} = ${twoDecimals(ideal)}` },
      { id: 'targets', x: 160, y: 172, text: `${whole(floor)} or ${whole(ceil)}`, tag: 'targets' },
    ],
    steps: [
      { caption: `${nameOf(abbr)} has ${whole(pop)} people and ${seats} seats.`, show: [] },
      { caption: `${whole(pop)} / ${seats} = ${twoDecimals(ideal)} people per district, which no district can hit exactly.`, show: ['ideal', 'chart'] },
      { caption: `So the target is the two neighbouring whole numbers: ${whole(floor)} and ${whole(ceil)}. Each bar is a district's final distance from the ideal, and ${onTarget.length} of ${seats} are within one person of it.`, show: ['ideal', 'targets', 'chart', 'chart-onTarget'] },
    ],
    chart: { kind: 'bars', values: metrics.districts.map((d) => d.pop), baseline: ideal, marks: { onTarget } },
  };
}

/** fingerprint.repeat: two independent runs over the same input produce the same assignment fingerprint. */
export async function fingerprintCase(ctx: ExtractContext): Promise<RuleCase> {
  const abbr = 'CO';
  const [{ metrics }, repeat] = await Promise.all([ctx.state(abbr), ctx.repeatMetrics(abbr)]);
  const base = { id: 'fingerprint.repeat', state: abbr, stateName: nameOf(abbr), source: {}, link: { state: abbr }, view: VIEW } as const;
  if (!repeat) {
    return {
      ...base,
      missing: 'no repeat run on disk',
      steps: [{ caption: 'A second run of the same state has not been generated yet, so there is no fingerprint to compare.', show: [] }],
    };
  }
  const a = metrics.assignmentSha256, b = repeat.assignmentSha256;
  if (a !== b) throw new DataError(abbr + ': the repeat run does not reproduce the plan (stale or non-deterministic out-repeat), refusing to publish a differing fingerprint');
  return {
    ...base,
    labels: [
      { id: 'hash-a', x: 160, y: 60, text: a, tag: 'hash' },
      { id: 'hash-b', x: 160, y: 110, text: b, tag: 'hash' },
    ],
    steps: [
      { caption: `Run the generator on ${nameOf(abbr)} and fingerprint the plan with SHA-256.`, show: ['hash-a'] },
      { caption: 'Run it again from scratch and fingerprint that plan too.', show: ['hash-a', 'hash-b'] },
      { caption: 'The two fingerprints are identical, so the two plans are identical.', show: ['hash-a', 'hash-b'] },
    ],
  };
}
