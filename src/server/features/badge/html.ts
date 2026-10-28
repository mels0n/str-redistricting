import { bareHost } from './referrer.js';

/** The paths that serve the badge image. */
const BADGE_PATHS = new Set(['/api/badge', '/badge.svg']);

export interface BadgeScan {
  /** An `<img>` shows the badge, or an `<a>` points at it. */
  badge: boolean;
  /** An `<a>` points at our site (not just at the image). */
  link: boolean;
  title: string | null;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Decodes the few character references that matter in an attribute or a title. */
function decode(text: string): string {
  return text.replace(/&(?:#(\d{1,6})|#x([0-9a-f]{1,5})|([a-z]{2,6}));/gi, (whole, dec: string | undefined, hex: string | undefined, name: string | undefined) => {
    if (name !== undefined) return ENTITIES[name.toLowerCase()] ?? whole;
    const code = dec !== undefined ? Number(dec) : parseInt(hex!, 16);
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : whole;
  });
}

/** The words of a page title: tags and control characters gone, spaces collapsed, at most 80 characters, or null when nothing is left. */
export function cleanTitle(raw: string): string | null {
  const text = decode(raw.replace(/<[^>]*>/g, ' '))
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (text === '') return null;
  return Array.from(text).slice(0, 80).join('').trim();
}

const ATTR = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

/** The attributes of a tag's inside, names lower-cased, values decoded. */
function attributes(inside: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of inside.matchAll(ATTR)) {
    const name = m[1]!.toLowerCase();
    if (!out.has(name)) out.set(name, decode(m[2] ?? m[3] ?? m[4] ?? ''));
  }
  return out;
}

function resolve(value: string | undefined, base: URL): URL | null {
  if (value === undefined || value.trim() === '') return null;
  try {
    const u = new URL(value.trim(), base);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u : null;
  } catch {
    return null;
  }
}

/**
 * Looks in a page for our badge and a link back to our site. Only real `<img src>` and `<a href>` attributes count; markup that is
 * shown as text (escaped), or sits in a comment, script, style or textarea, does not. Relative addresses are read against the
 * page's own address. The page must carry both: the badge alone is not enough.
 */
export function scanForBadge(html: string, pageUrl: string, siteHost: string): BadgeScan {
  const base = new URL(pageUrl);
  const ours = bareHost(siteHost);
  const bare = html
    .replace(/<!--[\s\S]*?(?:-->|$)/g, ' ')
    .replace(/<(script|style|textarea|template)\b[\s\S]*?(?:<\/\1\s*>|$)/gi, ' ');
  let badge = false;
  let link = false;
  for (const m of bare.matchAll(/<(a|img)\b([^>]*)>/gi)) {
    const tag = m[1]!.toLowerCase();
    const attrs = attributes(m[2]!);
    const target = resolve(attrs.get(tag === 'a' ? 'href' : 'src'), base);
    if (!target || bareHost(target.hostname) !== ours) continue;
    const isBadge = BADGE_PATHS.has(target.pathname.replace(/\/+$/, ''));
    if (isBadge) badge = true;
    else if (tag === 'a') link = true;
  }
  const t = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(bare);
  return { badge, link, title: t ? cleanTitle(t[1]!) : null };
}
