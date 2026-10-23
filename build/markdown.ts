import { JSDOM } from 'jsdom';

const DROP = 'svg, canvas, button, input, form, nav, header, footer, [aria-hidden="true"], .strv-how__no, .strv-skip, .strv-loading, .strv-how__real, [aria-busy="true"]';

/** Converts prerendered page markup to markdown for llms-full.txt. */
export function toMarkdown(html: string, site: string): string {
  const { document } = new JSDOM(`<body>${html}</body>`).window;
  for (const el of document.body.querySelectorAll(DROP)) el.remove();
  const blocks: string[] = [];
  walk(document.body, blocks, site);
  return blocks.join('\n\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

const squash = (s: string): string => s.replace(/\s+/g, ' ');

function inline(node: Node, site: string): string {
  if (node.nodeType === 3) return squash(node.textContent ?? '');
  if (node.nodeType !== 1) return '';
  const el = node as Element;
  const inner = [...el.childNodes].map((c) => inline(c, site)).join('');
  switch (el.tagName.toLowerCase()) {
    case 'a': {
      const href = el.getAttribute('href');
      return href === null || inner.trim() === '' ? inner : `[${inner.trim()}](${new URL(href, site + '/').href})`;
    }
    case 'strong':
    case 'b':
      return inner.trim() === '' ? inner : `**${inner.trim()}**`;
    case 'span':
      // A badge sits flush against its neighbours in the page; in text it is set off in parentheses.
      return el.classList.contains('strv-how__flag') ? ` (${inner.trim()})` : inner;
    case 'br':
      return ' ';
    default:
      return inner;
  }
}

const text = (el: Element, site: string): string => [...el.childNodes].map((c) => inline(c, site)).join('').trim();

function list(el: Element, site: string): string {
  const ordered = el.tagName.toLowerCase() === 'ol';
  return [...el.children]
    .filter((li) => li.tagName.toLowerCase() === 'li')
    .map((li, i) => `${ordered ? `${i + 1}.` : '-'} ${text(li, site)}`)
    .join('\n');
}

function table(el: Element, site: string): string {
  const rows = [...el.querySelectorAll('tr')].map((tr) => [...tr.children].map((c) => text(c, site).replace(/\|/g, '\\|')));
  const [head, ...rest] = rows;
  if (head === undefined) return '';
  const line = (cells: string[]): string => `| ${cells.join(' | ')} |`;
  return [line(head), line(head.map(() => '---')), ...rest.map(line)].join('\n');
}

const CONTAINERS = ['div', 'section', 'article', 'main', 'aside', 'figure', 'details', 'blockquote'];

function walk(parent: Element, out: string[], site: string): void {
  let run = '';
  const flush = (): void => {
    if (run.trim() !== '') out.push(run.trim());
    run = '';
  };
  for (const node of parent.childNodes) {
    if (node.nodeType !== 1) {
      run += inline(node, site);
      continue;
    }
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    if (/^h[1-3]$/.test(tag)) {
      flush();
      out.push(`${'#'.repeat(Number(tag[1]))} ${text(el, site)}`);
    } else if (tag === 'p') {
      flush();
      const t = text(el, site);
      if (t !== '') out.push(t);
    } else if (tag === 'ul' || tag === 'ol') {
      flush();
      out.push(list(el, site));
    } else if (tag === 'table') {
      flush();
      out.push(table(el, site));
    } else if (CONTAINERS.includes(tag)) {
      flush();
      walk(el, out, site);
    } else {
      run += inline(el, site);
    }
  }
  flush();
}
