import { h } from './dom';

type Inline = Node | string;

/** Only web and in-app links survive; anything else (javascript:, data:, relative) is shown as plain text. */
function safeHref(href: string): boolean {
  return /^https?:\/\/\S+$/i.test(href) || /^#\/\S*$/.test(href);
}

function inline(text: string): Inline[] {
  const out: Inline[] = [];
  const re = /\[([^\]]+)\]\(([^()\s]*(?:\([^()\s]*\)[^()\s]*)*)\)/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const [, label = '', href = ''] = m;
    out.push(safeHref(href) ? h('a', { href, ...(href.startsWith('#') ? {} : { rel: 'noopener noreferrer' }) }, label) : label);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/**
 * Renders the small markdown dialect the changelogs use: `#` and `##` headings
 * (shown as h2 and h3, the page owns the h1), `- ` bullets, paragraphs, and
 * `[text](url)` links. Built with `h()`, never innerHTML.
 */
export function renderChangelog(md: string): HTMLElement {
  const root = h('div', { class: 'strv-md' });
  let list: HTMLUListElement | null = null;
  let para: string[] = [];
  const flushPara = (): void => {
    if (para.length) root.append(h('p', null, inline(para.join(' '))));
    para = [];
  };
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const heading = /^(#{1,2})\s+(.*)$/.exec(line);
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    if (heading) {
      flushPara();
      list = null;
      root.append(h(heading[1] === '#' ? 'h2' : 'h3', null, inline(heading[2] ?? '')));
    } else if (bullet) {
      flushPara();
      if (!list) {
        list = h('ul');
        root.append(list);
      }
      list.append(h('li', null, inline(bullet[1] ?? '')));
    } else if (line.trim() === '') {
      flushPara();
      list = null;
    } else {
      list = null;
      para.push(line.trim());
    }
  }
  flushPara();
  return root;
}
