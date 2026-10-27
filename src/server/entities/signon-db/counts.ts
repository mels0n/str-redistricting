import { db } from './client.js';

/** One row of the `district_counts` view: confirmed signers in one combination of districts. */
export interface DistrictRow {
  state: string;
  usHouse: string | null;
  stateHouse: string | null;
  stateSenate: string | null;
  signers: number;
}

export interface AskRow {
  districtKey: string;
  asks: number;
}

/** The reads behind /api/counts and the write behind /api/ask. Tests pass an in-memory implementation. */
export interface CountsRepo {
  /** Every row of `district_counts` for one state. */
  districtRows(state: string): Promise<DistrictRow[]>;
  /** Confirmed signers across all states. */
  nationalTotal(): Promise<number>;
  /** Pending signers whose confirmation email is still queued. */
  waiting(): Promise<number>;
  /** Ask totals per district key for one state. */
  askRows(state: string): Promise<AskRow[]>;
  recordAsk(districtKey: string, office: string): Promise<void>;
}

const fail = (): never => {
  throw new Error('database error');
};

const PAGE = 1000;

export function countsRepo(): CountsRepo {
  return {
    async districtRows(state) {
      const out: DistrictRow[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await db().from('district_counts').select('state, us_house, state_house, state_senate, signers').eq('state', state).order('us_house').order('state_house').order('state_senate').range(from, from + PAGE - 1);
        if (error) fail();
        for (const r of data ?? []) out.push({ state: String(r.state), usHouse: r.us_house ?? null, stateHouse: r.state_house ?? null, stateSenate: r.state_senate ?? null, signers: Number(r.signers) });
        if ((data?.length ?? 0) < PAGE) return out;
      }
    },
    async nationalTotal() {
      const { count, error } = await db().from('signers').select('id', { count: 'exact', head: true }).eq('status', 'confirmed');
      if (error) fail();
      return count ?? 0;
    },
    async waiting() {
      const { count, error } = await db().from('email_outbox').select('id', { count: 'exact', head: true }).eq('status', 'queued').eq('kind', 'confirm');
      if (error) fail();
      return count ?? 0;
    },
    async askRows(state) {
      const out: AskRow[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await db().from('ask_counts').select('district_key, asks').like('district_key', `${state}:%`).order('district_key').range(from, from + PAGE - 1);
        if (error) fail();
        for (const r of data ?? []) out.push({ districtKey: String(r.district_key), asks: Number(r.asks) });
        if ((data?.length ?? 0) < PAGE) return out;
      }
    },
    async recordAsk(districtKey, office) {
      const { error } = await db().from('asks').insert({ district_key: districtKey, office });
      if (error) fail();
    },
  };
}
