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
  /** Paths on the site. Query ampersands are already written as &amp;, ready for an HTML attribute. */
  image: string;
  image2x?: string;
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

/** The image address, the links and the files to download for one badge. The site argument is the host the snippet is built for; paths here are relative to it. */
export function badgeAssets(c: BadgeChoice, _site: string): BadgeAssets {
  const dark = c.theme === 'dark' ? '-dark' : '';
  if (c.id === 'button') {
    const file = `/badge${dark}.svg`;
    return {
      image: c.theme === 'dark' ? '/api/badge?theme=dark' : '/api/badge',
      downloads: [{ label: `Button${c.theme === 'dark' ? ' (dark)' : ''}, SVG`, href: file }],
      href: '/pledges',
      alt: 'I back Fair Maps',
      ...SIZES.button,
    };
  }
  const params = new URLSearchParams();
  let href: string;
  let alt: string;
  let downloads: { label: string; href: string }[];
  if (c.id === 'state') {
    const abbr = c.abbr ?? '';
    const chamber: Chamber = c.chamber ?? 'federal-house';
    params.set('badge', 'state');
    params.set('state', abbr);
    if (chamber !== 'federal-house') params.set('chamber', QUERY_CHAMBER[chamber]);
    href = sharePath(abbr, chamber);
    const name = c.stateName ?? abbr;
    const seats = c.seats ?? 0;
    const headline = chamber === 'federal-house' ? `I support fair maps for ${name}` : `Fair maps for the ${name} ${CHAMBER_NAME[chamber]}`;
    alt = `${headline}: ${seats} ${seats === 1 ? 'district' : 'districts'} drawn by a rule. Fair Maps`;
    downloads = [{ label: 'PNG for the web (2x)', href: `/data/${chamberDataPath(abbr, chamber)}/badge${dark}@2x.png` }];
  } else {
    const fixed = FIXED[c.id];
    params.set('badge', c.id);
    href = fixed.href;
    alt = fixed.alt;
    downloads = [
      { label: 'PNG for the web (2x)', href: `/badges/${c.id}${dark}@2x.png` },
      { label: 'PNG for print', href: `/badges/${c.id}${dark}-print.png` },
    ];
  }
  if (c.theme === 'dark') params.set('theme', 'dark');
  const query = (extra: Record<string, string> = {}): string => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(extra)) p.set(k, v);
    return `/api/badge?${p.toString().replace(/&/g, '&amp;')}`;
  };
  return { image: query(), image2x: query({ scale: '2' }), downloads, href, alt, ...SIZES[c.id] };
}

/** The HTML a candidate pastes into their site: a plain link around the image, no script. */
export function badgeSnippet(c: BadgeChoice, site: string): string {
  const a = badgeAssets(c, site);
  const origin = `https://${site}`;
  const alt = escapeAttr(a.alt);
  if (c.id === 'button') return `<a href="${origin}${a.href}"><img src="${origin}${a.image}" alt="${alt}" width="${a.width}" height="${a.height}"></a>`;
  return `<a href="${origin}${a.href}"><img src="${origin}${a.image}" srcset="${origin}${a.image2x} 2x" width="${a.width}" height="${a.height}" alt="${alt}"></a>`;
}
