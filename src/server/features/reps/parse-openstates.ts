import { z } from 'zod';
import { RepSchema, type Rep } from './schema.js';

/** RFC 4180: comma separated, fields optionally quoted, `""` inside quotes is a quote, and a quoted field may hold commas and newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c !== '"') field += c;
      else if (src[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

const Row = z.object({
  id: z.string().regex(/^ocd-person\//),
  name: z.string().min(1),
  current_district: z.string().min(1),
  current_chamber: z.enum(['upper', 'lower', 'legislature']),
  email: z.string(),
  links: z.string(),
  capitol_voice: z.string(),
  capitol_address: z.string(),
  twitter: z.string(),
  instagram: z.string(),
  facebook: z.string(),
});

const REQUIRED = Object.keys(Row.shape);
const orNull = (v: string): string | null => (v.trim() === '' ? null : v.trim());

export interface OpenStatesParse {
  readonly reps: Rep[];
  /** Rows that failed validation (a joint or unknown chamber, a missing district, a malformed ID) and were left out. */
  readonly skipped: number;
}

/**
 * Current legislators of one state from its Open States CSV. `districtCode` is Open States' own district name
 * (`1`, `Chittenden-Central`); publishing swaps in the enacted district's code once the two are matched. The
 * `current_party` column is never read. Nebraska's single chamber (`legislature`) is filed as the state senate, the chamber
 * the Census Bureau draws it as.
 */
export function parseOpenStates(csv: string, state: string): OpenStatesParse {
  const [head, ...rows] = parseCsv(csv);
  if (head === undefined) return { reps: [], skipped: 0 };
  const missing = REQUIRED.filter((c) => !head.includes(c));
  if (missing.length > 0) throw new Error(`${state}: Open States CSV has no ${missing.join(', ')} column`);
  const reps: Rep[] = [];
  let skipped = 0;
  for (const cells of rows) {
    const parsed = Row.safeParse(Object.fromEntries(head.map((h, i) => [h, cells[i] ?? ''])));
    if (!parsed.success) {
      skipped++;
      continue;
    }
    const r = parsed.data;
    const social: Rep['social'] = {};
    if (r.twitter.trim() !== '') social.x = r.twitter.trim();
    if (r.facebook.trim() !== '') social.facebook = r.facebook.trim();
    if (r.instagram.trim() !== '') social.instagram = r.instagram.trim();
    reps.push(RepSchema.parse({
      id: r.id,
      name: r.name,
      office: r.current_chamber === 'lower' ? 'state-house' : 'state-senate',
      districtCode: r.current_district,
      contactUrl: null,
      email: orNull(r.email),
      phone: orNull(r.capitol_voice),
      address: orNull(r.capitol_address),
      website: orNull(r.links.split(';')[0] ?? ''),
      social,
    }));
  }
  if (skipped > 0) console.warn(`${state}: skipped ${skipped} Open States row(s) that failed validation`);
  return { reps, skipped };
}
