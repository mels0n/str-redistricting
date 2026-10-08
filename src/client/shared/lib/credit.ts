import { config, VERSIONS, type VersionStamp } from '../config';
import { h } from './dom';

export interface CreditSubject {
  /** A state's code; absent on the national map. */
  abbr?: string;
  name?: string;
  /** What the state's published data says drew it; absent on data published before versioning. */
  versions?: VersionStamp;
  /** The map's fingerprint (SHA-256 of the assignment file); the first 8 characters are shown. */
  sha?: string;
}

/** Below this frame width the credit uses its short form. */
export const CREDIT_COMPACT_BELOW = 520;

/** Room the strip takes along the bottom edge of a map, which the map keeps clear of (px). */
export const CREDIT_RESERVE_PX = 22;

/**
 * The provenance line drawn on a map, so any screenshot of it names the site, the release and the engine.
 * A state reads its stamp from its own published data; the national map reads the site's current versions.
 */
export function creditLine(p: CreditSubject, compact: boolean): string {
  const host = config.siteHost;
  if (p.abbr === undefined) {
    return compact ? `${host} · Maps ${VERSIONS.maps} · engine ${VERSIONS.engine}` : `${host} · Maps release ${VERSIONS.maps} · engine ${VERSIONS.engine}`;
  }
  const address = `${host}/${p.abbr}`;
  const short = p.sha ? p.sha.slice(0, 8) : null;
  const v = p.versions;
  if (!v) return compact || !p.name ? address : `${address} · ${p.name}`;
  if (compact) return [address, `Maps ${v.maps}`, short].filter((x): x is string => x !== null).join(' · ');
  return [address, p.name, `Maps release ${v.maps}`, `engine ${v.engine}`, short].filter((x): x is string => !!x).join(' · ');
}

export interface CreditStrip {
  /** Recompute the text, for a subject that changed (the plan shown has another fingerprint). */
  update(): void;
  destroy(): void;
}

/**
 * Puts the credit strip at the bottom of a map frame. It is decoration for screenshots (hidden from assistive
 * technology, which reads the page's own text) and never takes a click or a tap.
 */
export function mountCreditStrip(frame: HTMLElement, subject: () => CreditSubject): CreditStrip {
  const el = h('div', { class: 'strv-credit', 'aria-hidden': 'true' });
  frame.append(el);
  const update = (): void => {
    el.textContent = creditLine(subject(), frame.clientWidth > 0 && frame.clientWidth < CREDIT_COMPACT_BELOW);
  };
  update();
  const watch = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null;
  watch?.observe(frame);
  return {
    update,
    destroy() {
      watch?.disconnect();
      el.remove();
    },
  };
}
