import { z } from 'zod';
import { dataUrl, fetchJson } from '../../shared';
import type { PlanDistricts } from './locate';

const District = z.number().int().min(1);
const Pair = z.tuple([District, District]);

/** One state's block-to-district lookup: per tract, the common (finished, before) pair plus the blocks that differ. */
export const BlocksSchema = z
  .object({
    v: z.literal(1),
    state: z.string().regex(/^\d{2}$/),
    seats: z.number().int().min(1),
    tracts: z.record(z.string(), z.union([Pair, z.tuple([District, District, z.record(z.string(), Pair)])])),
  })
  .superRefine((b, ctx) => {
    const bad = (d: number): boolean => d > b.seats;
    for (const [t, v] of Object.entries(b.tracts)) {
      const all = [v[0], v[1], ...(v[2] ? Object.values(v[2]).flat() : [])];
      if (all.some(bad)) ctx.addIssue({ code: 'custom', message: `tract ${t} has a district above ${b.seats}`, path: ['tracts', t] });
    }
  });

export type Blocks = z.infer<typeof BlocksSchema>;

/** The block's district under each plan, or null when the id is not a 15-digit block in this state's known tracts. */
export function districtsForBlock(blocks: Blocks, geoid: string): PlanDistricts | null {
  if (!/^\d{15}$/.test(geoid) || geoid.slice(0, 2) !== blocks.state) return null;
  const tract = blocks.tracts[geoid.slice(2, 11)];
  if (!tract) return null;
  const pair = tract[2]?.[geoid.slice(11, 15)] ?? tract;
  return { finished: pair[0], before: pair[1] };
}

const cache = new Map<string, Promise<Blocks>>();

/** Loads a state's block lookup once; a failed load is forgotten so a retry fetches again. */
export function loadBlocks(abbr: string): Promise<Blocks> {
  let p = cache.get(abbr);
  if (!p) {
    p = fetchJson(dataUrl(`${abbr}/blocks.json`), BlocksSchema);
    p.catch(() => cache.delete(abbr));
    cache.set(abbr, p);
  }
  return p;
}
