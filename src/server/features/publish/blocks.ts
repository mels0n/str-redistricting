import { DataError } from '../../shared/errors/index.js';

type Pair = [number, number];
type Exceptions = Record<string, Pair>;

/** Block-to-district lookup for one state: each tract is its most common (finished, before) pair plus the blocks that differ. */
export interface Fingerprints {
  finished: string;
  before: string;
}

export interface BlocksFile {
  v: 1;
  state: string;
  seats: number;
  /** SHA-256 of each plan's assignment (the generator's assignmentSha256), so a file from another plan is detectable. */
  fingerprints: Fingerprints;
  tracts: Record<string, Pair | [number, number, Exceptions]>;
}

const GEOID = /^\d{15}$/;
const SHA256 = /^[0-9a-f]{64}$/;

function checkFingerprints(f: Fingerprints): void {
  if (!SHA256.test(f.finished) || !SHA256.test(f.before)) throw new DataError('plan fingerprints must be 64 lowercase hex characters');
}

/** Parses `GEOID20,district` rows (header first) into a map from GEOID to district. */
function parseAssignment(csv: string, label: string, seats: number): Map<string, number> {
  const out = new Map<string, number>();
  const lines = csv.split(/\r?\n/);
  if (lines[0]?.trim() !== 'GEOID20,district') throw new DataError(`${label}: expected header GEOID20,district`);
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (line === '') continue;
    const parts = line.split(',');
    const geoid = parts[0] ?? '';
    const raw = parts[1] ?? '';
    const district = /^\d+$/.test(raw) ? Number(raw) : NaN;
    if (parts.length !== 2 || !GEOID.test(geoid) || !Number.isInteger(district) || district < 1 || district > seats) {
      throw new DataError(`${label}: bad row ${i + 1}`);
    }
    if (out.has(geoid)) throw new DataError(`${label}: duplicate GEOID ${geoid}`);
    out.set(geoid, district);
  }
  return out;
}

/** Both plans' districts per GEOID, in the finished file's order; the two files must list the same blocks. */
function joinPlans(finishedCsv: string, beforeCsv: string, seats: number): Map<string, Pair> {
  const fin = parseAssignment(finishedCsv, 'finished assignment', seats);
  const bef = parseAssignment(beforeCsv, 'before assignment', seats);
  const out = new Map<string, Pair>();
  for (const [g, d] of fin) {
    const b = bef.get(g);
    if (b === undefined) throw new DataError(`block ${g} is missing from the before assignment`);
    out.set(g, [d, b]);
  }
  for (const g of bef.keys()) if (!fin.has(g)) throw new DataError(`block ${g} is missing from the finished assignment`);
  return out;
}

const tractOf = (geoid: string): string => geoid.slice(2, 11);
const suffixOf = (geoid: string): string => geoid.slice(11, 15);

export function encodeBlocks(stateFips: string, seats: number, finishedCsv: string, beforeCsv: string, fingerprints: Fingerprints): BlocksFile {
  checkFingerprints(fingerprints);
  const byTract = new Map<string, [string, Pair][]>();
  for (const [g, pair] of joinPlans(finishedCsv, beforeCsv, seats)) {
    if (g.slice(0, 2) !== stateFips) throw new DataError(`block ${g} is not in state ${stateFips}`);
    const t = tractOf(g);
    let list = byTract.get(t);
    if (!list) byTract.set(t, (list = []));
    list.push([g, pair]);
  }
  const tracts: BlocksFile['tracts'] = {};
  for (const [t, list] of [...byTract].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const counts = new Map<string, { pair: Pair; n: number }>();
    for (const [, p] of list) {
      const k = `${p[0]},${p[1]}`;
      const c = counts.get(k);
      if (c) c.n++;
      else counts.set(k, { pair: p, n: 1 });
    }
    let base: { pair: Pair; n: number } | null = null;
    for (const c of counts.values()) {
      if (!base || c.n > base.n || (c.n === base.n && (c.pair[0] < base.pair[0] || (c.pair[0] === base.pair[0] && c.pair[1] < base.pair[1])))) base = c;
    }
    const exceptions: Exceptions = {};
    let any = false;
    for (const [g, p] of list) {
      if (p[0] !== base!.pair[0] || p[1] !== base!.pair[1]) {
        exceptions[suffixOf(g)] = p;
        any = true;
      }
    }
    tracts[t] = any ? [base!.pair[0], base!.pair[1], exceptions] : [base!.pair[0], base!.pair[1]];
  }
  return { v: 1, state: stateFips, seats, fingerprints: { finished: fingerprints.finished, before: fingerprints.before }, tracts };
}

/** The block's (finished, before) districts in the file, or null when it is not covered. */
export function lookup(file: BlocksFile, geoid: string): Pair | null {
  if (!GEOID.test(geoid) || geoid.slice(0, 2) !== file.state) return null;
  const tract = file.tracts[tractOf(geoid)];
  if (!tract) return null;
  return tract[2]?.[suffixOf(geoid)] ?? [tract[0], tract[1]];
}

/**
 * Decodes every block of the file and compares it with the source CSVs; throws naming the first block that differs.
 * The file must also hold nothing the CSVs lack (tracts or block exceptions), and its state and seats must match `expected`.
 */
export function checkBlocks(file: BlocksFile, finishedCsv: string, beforeCsv: string, expected: { state: string; seats: number; fingerprints: Fingerprints }): void {
  if (file.state !== expected.state) throw new DataError(`blocks.json is for state ${file.state}, expected ${expected.state}`);
  if (file.seats !== expected.seats) throw new DataError(`blocks.json has ${file.seats} seats, expected ${expected.seats}`);
  if (file.fingerprints.finished !== expected.fingerprints.finished || file.fingerprints.before !== expected.fingerprints.before) {
    throw new DataError('blocks.json carries different plan fingerprints than the plans being published');
  }
  const plans = joinPlans(finishedCsv, beforeCsv, expected.seats);
  for (const [g, want] of plans) {
    const got = lookup(file, g);
    if (!got || got[0] !== want[0] || got[1] !== want[1]) {
      throw new DataError(`blocks.json disagrees with the assignment at block ${g}`);
    }
  }
  const tractsInCsv = new Set<string>();
  for (const g of plans.keys()) tractsInCsv.add(tractOf(g));
  for (const [t, v] of Object.entries(file.tracts)) {
    if (!tractsInCsv.has(t)) throw new DataError(`blocks.json has tract ${t} that is not in the assignment`);
    for (const suffix of Object.keys(v[2] ?? {})) {
      if (!plans.has(`${expected.state}${t}${suffix}`)) throw new DataError(`blocks.json has block ${expected.state}${t}${suffix} that is not in the assignment`);
    }
  }
}
