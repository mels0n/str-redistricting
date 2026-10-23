import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { PAGE_META } from '../src/client/shared/lib/page-meta';
import { SITE_HOST } from '../src/server/features/publish/site';
import { esc, swap } from './share-pages';
import { Resvg } from '@resvg/resvg-js';
import { toMarkdown } from './markdown';
import { LLMS_SUMMARY, jsonLd, jsonLdScript, llmsTxt, robotsTxt, sitemapXml, type FaqEntry, type PageKey } from './seo';

const DIST = 'dist';
const KEYS: readonly PageKey[] = ['home', 'how', 'faq', 'changelog'];
const ROOT_TAG = '<div id="str-viewer"></div>';

/** Renders one page with the real page code in jsdom and returns the markup inside `#str-viewer`, plus the FAQ entries for the FAQ page. */
export async function renderPage(key: PageKey, shell = readFileSync(join(DIST, 'index.html'), 'utf8')): Promise<{ html: string; faq: FaqEntry[] }> {
  const dom = installDom(shell, PAGE_META[key].path);
  const { mountShell, pages } = await modules();
  const root = dom.window.document.getElementById('str-viewer');
  if (!root) throw new Error('prerender: the built index.html has no #str-viewer');
  const outlet = mountShell(root);
  outlet.append(pages[key]().el);
  const faq = key === 'faq' ? faqEntries(root) : [];
  // The site's style-src is 'self': an inline style attribute would be blocked, so none is written.
  for (const el of root.querySelectorAll('[style]')) el.removeAttribute('style');
  const html = root.innerHTML;
  dom.window.close();
  return { html, faq };
}

let loaded: Promise<{ mountShell: typeof import('../src/client/app/shell').mountShell; pages: Record<PageKey, () => { el: HTMLElement }> }> | null = null;

/** Installs a fresh jsdom on `globalThis`. Browser APIs the page code needs that jsdom lacks are stubbed here: requestAnimationFrame (no-op), cancelAnimationFrame (no-op), matchMedia (never matches), fetch (never settles). */
function installDom(shell: string, path: string): JSDOM {
  const dom = new JSDOM(shell, { url: `https://${SITE_HOST}${path}`, pretendToBeVisual: false });
  const w = dom.window;
  const define = (name: string, value: unknown): void => {
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  };
  define('window', w);
  define('document', w.document);
  define('location', w.location);
  define('history', w.history);
  define('HTMLElement', w.HTMLElement);
  define('Node', w.Node);
  define('requestAnimationFrame', () => 0);
  define('cancelAnimationFrame', () => undefined);
  define('matchMedia', () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined }));
  w.requestAnimationFrame = () => 0;
  w.matchMedia = globalThis.matchMedia;
  // Async loads never land: the output holds only the text the pages build synchronously.
  define('fetch', () => new Promise(() => {}));
  w.fetch = globalThis.fetch;
  return dom;
}

function modules(): NonNullable<typeof loaded> {
  loaded ??= (async () => {
    // The changelog page imports its markdown with Vite's `?raw`; this gives that suffix the same meaning here.
    register('./raw-loader.mjs', import.meta.url);
    const [{ mountShell }, { createNationalPage }, { createHowPage }, { createFaqPage }, { createChangelogPage }] = await Promise.all([
      import('../src/client/app/shell'),
      import('../src/client/pages/national'),
      import('../src/client/pages/how'),
      import('../src/client/pages/faq'),
      import('../src/client/pages/changelog'),
    ]);
    return {
      mountShell,
      pages: {
        home: () => createNationalPage(() => undefined, 'federal-house'),
        how: () => createHowPage({ page: 'how', section: null }),
        faq: () => createFaqPage({ page: 'faq', question: null }),
        changelog: () => createChangelogPage(),
      },
    };
  })();
  return loaded;
}

function faqEntries(root: Element): FaqEntry[] {
  return [...root.querySelectorAll('section.strv-how__section')].map((section) => {
    const h2 = section.querySelector('h2')?.cloneNode(true) as HTMLElement | undefined;
    h2?.querySelector('.strv-how__no')?.remove();
    const a = [...section.querySelectorAll('p, li')].map((n) => (n.textContent ?? '').trim()).filter((t) => t !== '').join('\n\n');
    return { q: (h2?.textContent ?? '').trim(), a };
  });
}

function headFor(key: PageKey, shell: string): string {
  const { title, description, path } = PAGE_META[key];
  const url = `https://${SITE_HOST}${path === '/' ? '/' : path}`;
  const meta = (attr: 'name' | 'property', k: string, value: string): [RegExp, string, string] =>
    [new RegExp(`<meta ${attr}="${k}" content="[^"]*" ?/?>`), `<meta ${attr}="${k}" content="${esc(value)}" />`, `${k} meta`];
  const swaps: [RegExp, string, string][] = [
    [/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`, 'title'],
    meta('name', 'description', description),
    [/<link rel="canonical" href="[^"]*" ?\/?>/, `<link rel="canonical" href="${url}" />`, 'canonical link'],
    meta('property', 'og:url', url),
    meta('property', 'og:title', title),
    meta('property', 'og:description', description),
  ];
  return swaps.reduce((html, [pattern, replacement, what]) => swap(html, pattern, replacement, what), shell);
}

/** The shell with this page's contents, head tags and structured data. */
export function pageHtml(key: PageKey, shell: string, rendered: { html: string; faq: FaqEntry[] }): string {
  const withHead = headFor(key, shell);
  if (!withHead.includes(ROOT_TAG)) throw new Error('prerender: the built index.html has no empty #str-viewer');
  const withBody = withHead.replace(ROOT_TAG, () => `<div id="str-viewer" class="strv">${rendered.html}</div>`);
  const script = jsonLdScript(jsonLd(key, rendered.faq));
  return script === '' ? withBody : withBody.replace('</head>', () => `    ${script}
  </head>`);
}

/** The page served for any address that is not a page: kept out of search results, with a way home. */
export function notFoundHtml(shell: string): string {
  const withHead = shell
    .replace(/<title>[^<]*<\/title>/, () => '<title>Page not found | Fair Maps</title>')
    .replace(/<link rel="canonical"[^>]*>\s*/, () => '')
    // A missing page must not boot the app, which would route the unknown address to the home page.
    .replace(/<script type="module"[^>]*><\/script>\s*/, () => '')
    .replace('<meta charset="utf-8" />', () => `<meta charset="utf-8" />\n    <meta name="robots" content="noindex">`);
  const body = '<div id="str-viewer"><p>That page doesn’t exist. <a href="/">Go to Fair Maps</a></p></div>';
  return withHead.replace(ROOT_TAG, () => body);
}

/** A single-image ICO file: the PNG behind a 22-byte header. */
function ico(png48: Buffer): Buffer {
  const head = Buffer.alloc(22);
  head.writeUInt16LE(1, 2); // type: icon
  head.writeUInt16LE(1, 4); // one image
  head[6] = 48;
  head[7] = 48;
  head.writeUInt16LE(1, 10); // planes
  head.writeUInt16LE(32, 12); // bits per pixel
  head.writeUInt32LE(png48.length, 14);
  head.writeUInt32LE(22, 18);
  return Buffer.concat([head, png48]);
}

export async function main(): Promise<void> {
  const shell = readFileSync(join(DIST, 'index.html'), 'utf8');
  const site = `https://${SITE_HOST}`;
  const outputs = new Map<string, string | Buffer>();
  const markdown = new Map<PageKey, string>();
  for (const key of KEYS) {
    const file = key === 'home' ? join(DIST, 'index.html') : join(DIST, PAGE_META[key].path, 'index.html');
    const rendered = await renderPage(key, shell);
    markdown.set(key, toMarkdown(rendered.html, site));
    outputs.set(file, pageHtml(key, shell, rendered));
  }
  outputs.set(join(DIST, 'sitemap.xml'), sitemapXml(site));
  outputs.set(join(DIST, 'robots.txt'), robotsTxt(site));
  outputs.set(join(DIST, 'llms.txt'), llmsTxt(site));
  const sections = (['home', 'faq', 'how'] as const).map((k) => `---\n\n${markdown.get(k) ?? ''}`);
  outputs.set(join(DIST, 'llms-full.txt'), ['# Fair Maps', LLMS_SUMMARY, ...sections].join('\n\n').trimEnd() + '\n');
  const svg = readFileSync(join('public', 'favicon.svg'));
  const png = (width: number): Buffer => Buffer.from(new Resvg(svg, { fitTo: { mode: 'width', value: width } }).render().asPng());
  outputs.set(join(DIST, 'apple-touch-icon.png'), png(180));
  outputs.set(join(DIST, 'favicon.ico'), ico(png(48)));
  outputs.set(join(DIST, '404.html'), notFoundHtml(shell));
  for (const [file, html] of outputs) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, html);
  }
  console.log(`prerender: wrote ${[...outputs.keys()].join(', ')}`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : 'prerender failed');
    process.exit(1);
  });
}
