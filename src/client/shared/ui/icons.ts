import { h, svg } from '../lib/dom';

/** A 16px stroke arrow, drawn to sit beside the filled play and step icons. */
function arrow(d: string): SVGSVGElement {
  return svg('svg', { viewBox: '0 0 16 16', width: 16, height: 16, 'aria-hidden': 'true', focusable: 'false', class: 'strv-icon strv-icon--stroke' }, svg('path', { d }));
}

export const iconArrowLeft = (): SVGSVGElement => arrow('M13 8H3.25M7.5 3.5L3 8l4.5 4.5');
export const iconArrowDown = (): SVGSVGElement => arrow('M8 3v9.75M3.5 8.5L8 13l4.5-4.5');
export const iconArrowRight = (): SVGSVGElement => arrow('M3 8h9.75M8.5 3.5L13 8l-4.5 4.5');

/** A disclosure chevron: points down when closed; the page turns it over when open. */
export const iconChevronDown = (): SVGSVGElement => arrow('M3.5 6l4.5 4.5L12.5 6');

/** A magnifier with a plus, for "zoom to". */
export const iconZoomIn = (): SVGSVGElement => arrow('M7 2.75a4.25 4.25 0 1 1 0 8.5a4.25 4.25 0 1 1 0-8.5zM10.25 10.25L13.5 13.5M7 5v4M5 7h4');

/**
 * "A to B" between two figures: a drawn arrow for the eye, the word "to" for
 * screen readers and for copied text.
 */
export function arrowTo(): HTMLElement {
  return h('span', { class: 'strv-to' }, iconArrowRight(), h('span', { class: 'strv-visually-hidden' }, ' to '));
}

/** Share: a box with an arrow leaving it upward. */
export const iconShare = (): SVGSVGElement => arrow('M8 10V2.5M4.75 5.5L8 2.25l3.25 3.25M5 7.5H3v6h10v-6h-2');
