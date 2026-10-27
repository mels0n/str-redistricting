import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { STATES } from '../../shared/apportionment/index.js';
import { DataError } from '../../shared/errors/index.js';
import type { DownloadOptions } from '../../shared/http/index.js';
import { LEGISLATORS_FILE, openStatesFile, readRepsSources, readVerified, SOCIAL_FILE } from './download.js';
import { checkAliases, matchStateDistricts, normalizeDistrict } from './match.js';
import { parseCongress } from './parse-congress.js';
import { parseOpenStates } from './parse-openstates.js';
import { CoverageSchema, districtKey, STATEWIDE_CODE, StateRepsSchema, type Coverage, type Office, type Rep, type StateReps } from './schema.js';

export interface PublishRepsInput {
  readonly configDir: string;
  readonly cacheDir: string;
  /** `public/data`: enacted districts are read from here and `reps/` is written into it. */
  readonly publicDir: string;
  readonly download?: DownloadOptions;
  /** Limit the run to these states (two-letter abbreviations); every state when omitted. */
  readonly only?: readonly string[];
}

const EnactedTopo = z.object({ objects: z.object({ enacted: z.object({ geometries: z.array(z.object({ properties: z.object({ code: z.string().min(1) }).passthrough() }).passthrough()) }).passthrough() }).passthrough() }).passthrough();

/** More empty House seats than this means the source is broken, not that many members left. */
const MAX_EMPTY_HOUSE_SEATS = 15;

const sortedJson = (o: unknown): string => `${JSON.stringify(o, null, 2)}\n`;

/** The `code` of each district in `<publicDir>/<ST>[/<chamber>]/enacted.topo.json`, or null when the state has no such file. */
async function enactedCodes(publicDir: string, abbr: string, chamber: 'us-house' | 'state-house' | 'state-senate'): Promise<string[] | null> {
  const path = join(publicDir, abbr, ...(chamber === 'us-house' ? [] : [chamber]), 'enacted.topo.json');
  if (!existsSync(path)) return null;
  const topo = EnactedTopo.parse(JSON.parse(await readFile(path, 'utf8')) as unknown);
  return topo.objects.enacted.geometries.map((g) => g.properties.code);
}

async function writeAtomic(path: string, text: string): Promise<void> {
  const part = `${path}.${process.pid}.${randomUUID()}.part`;
  await writeFile(part, text, 'utf8');
  await rename(part, path);
}

const add = (byKey: Record<string, Rep[]>, key: string, rep: Rep): void => {
  (byKey[key] ??= []).push(rep);
};

/**
 * Build `public/data/reps/<ST>.json` for every state and `coverage.json`. Every source is checked against
 * config/reps-sources.json first, and the run stops if any hash differs. An enacted US House district with no member is
 * recorded as vacant in coverage.json and the run goes on, unless an implausible number of seats are empty or a state has
 * no senators. State legislative districts that cannot be paired with an Open
 * States district are left out of the state file and listed in coverage.json.
 */
export async function publishReps(input: PublishRepsInput): Promise<{ coverage: Coverage }> {
  const sources = await readRepsSources(input.configDir);
  const aliases = z.record(z.string(), z.string()).parse(JSON.parse((await readFile(join(input.configDir, 'reps-district-aliases.json'), 'utf8')).replace(/^﻿/, '')) as unknown);
  const textOf = (name: string): Promise<string> => {
    const source = sources[name];
    if (source === undefined) throw new DataError(`${name} is not listed in config/reps-sources.json; run reps:pin`);
    return readVerified(name, source, input.cacheDir, input.download);
  };
  const congress = parseCongress(JSON.parse(await textOf(LEGISLATORS_FILE)) as unknown, JSON.parse(await textOf(SOCIAL_FILE)) as unknown);
  const hash = (name: string): string => sources[name]!.sha256;

  const out: StateReps[] = [];
  const coverage: Coverage = {};
  const emptySeats: string[] = [];
  const noSenators: string[] = [];
  const overfullSenates: string[] = [];
  const checked = new Set<string>();
  for (const state of STATES.filter((s) => input.only === undefined || input.only.includes(s.abbr))) {
    const byKey: Record<string, Rep[]> = {};
    const mine = congress.filter((r) => r.state === state.abbr);
    for (const { state: _state, ...rep } of mine) {
      add(byKey, districtKey(state.abbr, rep.office, rep.office === 'us-senate' ? STATEWIDE_CODE : rep.districtCode!), rep);
    }
    const senators = mine.filter((r) => r.office === 'us-senate').length;
    if (senators === 0) noSenators.push(state.abbr);
    if (senators > 2) overfullSenates.push(state.abbr);
    const vacant: string[] = [];
    for (const code of (await enactedCodes(input.publicDir, state.abbr, 'us-house')) ?? []) {
      if (byKey[districtKey(state.abbr, 'us-house', code)] === undefined) vacant.push(`${state.abbr}-${code}`);
    }
    emptySeats.push(...vacant);

    const csvName = openStatesFile(state.abbr);
    const { reps } = parseOpenStates(await textOf(csvName), state.abbr);
    const cov: Coverage[string] = {};
    if (vacant.length > 0) cov['us-house'] = { vacant };
    for (const office of ['state-house', 'state-senate'] as const satisfies readonly Office[]) {
      const codes = await enactedCodes(input.publicDir, state.abbr, office);
      if (codes === null) continue;
      const theirs = reps.filter((r) => r.office === office);
      checked.add(`${state.abbr}:${office}:`);
      const bad = checkAliases(state.abbr, office, codes, theirs.map((r) => r.districtCode!), aliases);
      if (bad.length > 0) throw new DataError(`config/reps-district-aliases.json: ${bad.join('; ')}`);
      const m = matchStateDistricts(state.abbr, office, codes, theirs.map((r) => r.districtCode!), aliases);
      const byOpenStates = new Map<string, string>(Object.entries(m.matched).flatMap(([code, os]) => os.split('|').map((name): [string, string] => [normalizeDistrict(name), code])));
      for (const rep of theirs) {
        const code = byOpenStates.get(normalizeDistrict(rep.districtCode!));
        if (code !== undefined) add(byKey, districtKey(state.abbr, office, code), { ...rep, districtCode: code });
      }
      cov[office] = { matched: Object.keys(m.matched).length, unmatched: m.unmatchedEnacted };
    }
    coverage[state.abbr] = cov;
    out.push(StateRepsSchema.parse({
      state: state.abbr,
      generatedFrom: { [LEGISLATORS_FILE]: hash(LEGISLATORS_FILE), [SOCIAL_FILE]: hash(SOCIAL_FILE), [csvName]: hash(csvName) },
      byKey,
    }));
  }
  if (input.only === undefined) {
    const orphan = Object.keys(aliases).filter((k) => ![...checked].some((c) => k.startsWith(c)));
    if (orphan.length > 0) throw new DataError(`config/reps-district-aliases.json: no enacted districts for ${orphan.join(', ')}`);
  }
  // A House seat with no member is published as vacant. These guards catch a broken source file instead: a whole
  // state with no senators, a state with too many, or far more empty House seats than any real stretch of vacancies.
  if (noSenators.length > 0) throw new DataError(`no U.S. senator found for ${noSenators.join(', ')}; the legislators file looks broken`);
  if (overfullSenates.length > 0) throw new DataError(`more than two U.S. senators found for ${overfullSenates.join(', ')}; the legislators file looks broken`);
  if (emptySeats.length > MAX_EMPTY_HOUSE_SEATS) throw new DataError(`${emptySeats.length} U.S. House seats have no member (more than ${MAX_EMPTY_HOUSE_SEATS}): ${emptySeats.join(', ')}; the legislators file looks broken`);

  const dir = join(input.publicDir, 'reps');
  await mkdir(dir, { recursive: true });
  for (const file of out) await writeAtomic(join(dir, `${file.state}.json`), sortedJson(file));
  await writeAtomic(join(dir, 'coverage.json'), sortedJson(CoverageSchema.parse(coverage)));
  return { coverage };
}
