import { z } from 'zod';
import type { AskRow, CountsRepo, DistrictRow } from '../../entities/signon-db/index.js';
import { SignonError } from '../../shared/errors/signon.js';

const OFFICES = ['us-house', 'us-senate', 'state-house', 'state-senate'] as const;
const STATE = /^[A-Z]{2}$/;

/** `CO:state-house:012`: state, office, code. Mirrors the client's districtKey. */
const KEY = /^[A-Z]{2}:(us-house|us-senate|state-house|state-senate):[A-Za-z0-9-]{1,12}$/;

export const AskRequestSchema = z
  .strictObject({ key: z.string().regex(KEY), office: z.enum(OFFICES) })
  .refine((v) => v.key.split(':')[1] === v.office);
export type AskRequest = z.infer<typeof AskRequestSchema>;

export const CountsQuerySchema = z.strictObject({ state: z.string().regex(STATE).optional() });

/** Signers per district key; ask totals sit under `${key}#asks`. */
export interface DistrictCounts {
  national: number;
  state: number;
  waiting: number;
  byKey: Record<string, number>;
}

/** The U.S. Senate seats are statewide: they share one key per state. */
const SENATE_CODE = 'state';

export function buildCounts(state: string, rows: DistrictRow[], asks: AskRow[], national: number, waiting: number): DistrictCounts {
  const byKey: Record<string, number> = {};
  const add = (office: (typeof OFFICES)[number], code: string | null, n: number): void => {
    if (code === null) return;
    const key = `${state}:${office}:${code}`;
    byKey[key] = (byKey[key] ?? 0) + n;
  };
  let total = 0;
  for (const r of rows) {
    total += r.signers;
    add('us-house', r.usHouse, r.signers);
    add('state-house', r.stateHouse, r.signers);
    add('state-senate', r.stateSenate, r.signers);
  }
  add('us-senate', SENATE_CODE, total);
  for (const a of asks) byKey[`${a.districtKey}#asks`] = a.asks;
  return { national, state: total, waiting, byKey };
}

/** The numbers for GET /api/counts. Without a state only the national total and the waiting count come back. */
export async function readCounts(query: unknown, repo: CountsRepo): Promise<Partial<DistrictCounts> & { national: number; waiting: number }> {
  const parsed = CountsQuerySchema.safeParse(query);
  if (!parsed.success) throw new SignonError('bad-request');
  const { state } = parsed.data;
  const [national, waiting] = await Promise.all([repo.nationalTotal(), repo.waiting()]);
  if (!state) return { national, waiting };
  const [rows, asks] = await Promise.all([repo.districtRows(state), repo.askRows(state)]);
  return buildCounts(state, rows, asks, national, waiting);
}

/** Validates an ask and stores it. */
export async function recordAsk(body: unknown, repo: CountsRepo): Promise<void> {
  const parsed = AskRequestSchema.safeParse(body);
  if (!parsed.success) throw new SignonError('bad-request');
  await repo.recordAsk(parsed.data.key, parsed.data.office);
}
