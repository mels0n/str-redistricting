import { svg } from '../lib/dom';

/** A 16px stroke arrow, drawn to sit beside the filled play and step icons. */
function arrow(d: string): SVGSVGElement {
  return svg('svg', { viewBox: '0 0 16 16', width: 16, height: 16, 'aria-hidden': 'true', focusable: 'false', class: 'strv-icon strv-icon--stroke' }, svg('path', { d }));
}

export const iconArrowLeft = (): SVGSVGElement => arrow('M13 8H3.25M7.5 3.5L3 8l4.5 4.5');
export const iconArrowDown = (): SVGSVGElement => arrow('M8 3v9.75M3.5 8.5L8 13l4.5-4.5');
