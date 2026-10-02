type Attrs = Record<string, string | number | boolean | null | undefined | ((ev: Event) => void)>;
type Child = Node | string | number | null | undefined | false;

/**
 * Small element factory. Attributes starting with "on" bind listeners;
 * `class` and any other attribute are set as attributes; `false`/`null`
 * attributes are skipped.
 */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs | null = null,
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) applyAttrs(el, attrs);
  append(el, children);
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Attrs | null = null,
  ...children: (Child | Child[])[]
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  if (attrs) applyAttrs(el, attrs);
  append(el, children);
  return el;
}

function applyAttrs(el: Element, attrs: Attrs): void {
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (typeof v === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (k === 'style') {
      // Through the style object, not setAttribute, so a Content-Security-Policy without 'unsafe-inline' allows it.
      (el as HTMLElement).style.cssText = String(v);
    } else {
      el.setAttribute(k, v === true ? '' : String(v));
    }
  }
}

function append(el: Element, children: (Child | Child[])[]): void {
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Announces a short message to screen readers through a shared live region. */
export function announce(message: string): void {
  let region = document.getElementById('strv-live');
  if (!region) {
    region = h('div', { id: 'strv-live', class: 'strv-visually-hidden', 'aria-live': 'polite', role: 'status' });
    document.body.append(region);
  }
  region.textContent = '';
  // A new text node after a tick makes repeated messages read again.
  const target = region;
  window.setTimeout(() => {
    target.textContent = message;
  }, 30);
}
