import { z } from 'zod';
import { STATES } from '../../shared/apportionment/index.js';
import { BADGE_SVG, BADGE_SVG_DARK } from './svg.js';

const FIXED = ['crest', 'seal', 'pledge'] as const;
const CHAMBERS = ['house', 'senate'] as const;
const THEMES = ['light', 'dark'] as const;

/** The query of /api/badge. Unknown parameters are ignored; anything invalid is answered with the plain button (see badgeAnswer). */
export const BadgeQuerySchema = z.object({
  badge: z.enum([...FIXED, 'state']).optional(),
  state: z.string().refine((s) => STATES.some((x) => x.abbr === s)).optional(),
  chamber: z.enum(CHAMBERS).optional(),
  theme: z.enum(THEMES).optional(),
  scale: z.literal('2').optional(),
});
export type BadgeQuery = z.infer<typeof BadgeQuerySchema>;

export type BadgeAnswer = { kind: 'svg'; svg: string } | { kind: 'redirect'; path: string };

const suffix = (theme: string | undefined, scale: string | undefined) => `${theme === 'dark' ? '-dark' : ''}${scale === '2' ? '@2x' : ''}.png`;

/** The static file a valid query points at. A state badge needs a state, and Nebraska has no House. */
function pathFor(q: BadgeQuery): string | null {
  if (q.badge === undefined) return null;
  const end = suffix(q.theme, q.scale);
  if (q.badge !== 'state') return `/badges/${q.badge}${end}`;
  if (q.state === undefined || (q.state === 'NE' && q.chamber === 'house')) return null;
  const folder = q.chamber === undefined ? '' : `/state-${q.chamber}`;
  return `/data/${q.state}${folder}/badge${end}`;
}

/** What /api/badge sends for a request address: the button, or a redirect to a badge file. Invalid queries get the light button, never an error. */
export function badgeAnswer(url: URL): BadgeAnswer {
  const params = Object.fromEntries(url.searchParams);
  const parsed = BadgeQuerySchema.safeParse(params);
  if (!parsed.success) return { kind: 'svg', svg: BADGE_SVG };
  const path = pathFor(parsed.data);
  if (path !== null) return { kind: 'redirect', path };
  if (parsed.data.badge !== undefined) return { kind: 'svg', svg: BADGE_SVG };
  return { kind: 'svg', svg: parsed.data.theme === 'dark' ? BADGE_SVG_DARK : BADGE_SVG };
}

/** Every path badgeAnswer can redirect to, so a test can check that each file exists. */
export function badgeTargets(): string[] {
  const ends = THEMES.flatMap((t) => ['', '2'].map((s) => suffix(t, s || undefined)));
  const out: string[] = [];
  for (const name of FIXED) for (const end of ends) out.push(`/badges/${name}${end}`);
  for (const { abbr } of STATES) {
    for (const folder of ['', '/state-senate', ...(abbr === 'NE' ? [] : ['/state-house'])]) for (const end of ends) out.push(`/data/${abbr}${folder}/badge${end}`);
  }
  return out;
}
