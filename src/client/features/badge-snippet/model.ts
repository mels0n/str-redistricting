import { config, chamberDataPath, sharePath, type Chamber } from '../../shared';

export interface BadgeChoice {
  id: 'crest' | 'seal' | 'pledge' | 'button' | 'state';
  theme: 'light' | 'dark';
  /** The state badge's state: abbreviation, name and the chamber's district count. */
  abbr?: string;
  chamber?: Chamber;
  stateName?: string;
  seats?: number;
}

export interface BadgeAssets {
  /** Absolute addresses with a plain `&`, ready to set as a DOM src or href. Only the snippet escapes them. */
  image: string;
  image2x?: string;
  /** The same pictures from the page's own origin, for the preview on /badges: a preview deployment's CSP only lets images load from itself, and the dev server answers /api/badge locally. */
  previewImage: string;
  previewImage2x?: string;
  downloads: { label: string; href: string }[];
  href: string;
  alt: string;
  width: number;
  height: number;
}

/** The live button snippet, as /pledges has always shown it. */
export const BADGE_SNIPPET = `<a href="https://${config.siteHost}/pledges"><img src="https://${config.siteHost}/api/badge" alt="I back Fair Maps" width="200" height="40"></a>`;

const SIZES = {
  crest: { width: 160, height: 190 },
  seal: { width: 180, height: 180 },
  pledge: { width: 200, height: 150 },
  button: { width: 200, height: 40 },
  state: { width: 300, height: 240 },
} as const;

const FIXED = {
  crest: { href: '/', alt: 'Fair Maps: districts drawn by a rule', label: 'Crest' },
  seal: { href: '/faq/gerrymandering', alt: 'End gerrymandering. Fair Maps', label: 'Seal' },
  pledge: { href: '/', alt: 'I pledge to support fair maps. Fair Maps', label: 'Pledge' },
} as const;

const escapeAttr = (s: string): string => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const QUERY_CHAMBER = { 'state-house': 'house', 'state-senate': 'senate' } as const;
const CHAMBER_NAME = { 'state-house': 'House', 'state-senate': 'Senate' } as const;

/** The image address, the links and the files to download for one badge. The site argument is the host; every address comes back absolute (https://{site}/...) with a plain `&`, except the two preview paths. */
export function badgeAssets(c: BadgeChoice, site: string): BadgeAssets {
  const origin = `https://${site}`;
  const dark = c.theme === 'dark' ? '-dark' : '';
  if (c.id === 'button') {
    const file = `/badge${dark}.svg`;
    const path = c.theme === 'dark' ? '/api/badge?theme=dark' : '/api/badge';
    return {
      image: `${origin}${path}`,
      previewImage: path,
      downloads: [{ label: `Button${c.theme === 'dark' ? ' (dark)' : ''}, SVG`, href: `${origin}${file}` }],
      href: `${origin}/pledges`,
      alt: 'I back Fair Maps',
      ...SIZES.button,
    };
  }
  const params = new URLSearchParams();
  let href: string;
  let alt: string;
  let downloads: { label: string; href: string }[];
  if (c.id === 'state') {
    const { abbr, stateName: name, seats } = c;
    if (abbr === undefined || name === undefined || seats === undefined) throw new Error('A state badge needs a state abbreviation, a name and a district count');
    const chamber: Chamber = c.chamber ?? 'federal-house';
    params.set('badge', 'state');
    params.set('state', abbr);
    if (chamber !== 'federal-house') params.set('chamber', QUERY_CHAMBER[chamber]);
    href = `${origin}${sharePath(abbr, chamber)}`;
    const headline = chamber === 'federal-house' ? `I support fair maps for ${name}` : `Fair maps for the ${name} ${CHAMBER_NAME[chamber]}`;
    alt = `${headline}: ${seats} ${seats === 1 ? 'district' : 'districts'} drawn by a rule. Fair Maps`;
    downloads = [{ label: 'PNG for the web (2x)', href: `${origin}/data/${chamberDataPath(abbr, chamber)}/badge${dark}@2x.png` }];
  } else {
    const fixed = FIXED[c.id];
    params.set('badge', c.id);
    href = `${origin}${fixed.href}`;
    alt = fixed.alt;
    downloads = [
      { label: 'PNG for the web (2x)', href: `${origin}/badges/${c.id}${dark}@2x.png` },
      { label: 'PNG for print', href: `${origin}/badges/${c.id}${dark}-print.png` },
    ];
  }
  if (c.theme === 'dark') params.set('theme', 'dark');
  const path = (extra: Record<string, string> = {}): string => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(extra)) p.set(k, v);
    return `/api/badge?${p.toString()}`;
  };
  return { image: `${origin}${path()}`, image2x: `${origin}${path({ scale: '2' })}`, previewImage: path(), previewImage2x: path({ scale: '2' }), downloads, href, alt, ...SIZES[c.id] };
}

/** The HTML a candidate pastes into their site: a plain link around the image, no script. */
export function badgeSnippet(c: BadgeChoice, site: string): string {
  const a = badgeAssets(c, site);
  const href = escapeAttr(a.href);
  const src = escapeAttr(a.image);
  const alt = escapeAttr(a.alt);
  if (c.id === 'button') return `<a href="${href}"><img src="${src}" alt="${alt}" width="${a.width}" height="${a.height}"></a>`;
  return `<a href="${href}"><img src="${src}" srcset="${escapeAttr(a.image2x ?? a.image)} 2x" width="${a.width}" height="${a.height}" alt="${alt}"></a>`;
}
