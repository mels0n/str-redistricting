import type { Versions } from '../../shared/config/index.js';
import type { Component } from './components.js';

/** One tag per component whose identity changed; with no previous versions (a root commit) every component is tagged. */
export function tagsFor(prev: Versions | null, next: Versions): string[] {
  const tags: string[] = [];
  if (prev === null || prev.engine !== next.engine) tags.push(`engine-v${next.engine}`);
  if (prev === null || prev.input.vintage !== next.input.vintage || prev.input.revision !== next.input.revision) {
    tags.push(`input-${next.input.vintage}-r${next.input.revision}`);
  }
  if (prev === null || prev.maps !== next.maps) tags.push(`maps-${next.maps}`);
  if (prev === null || prev.schema !== next.schema) tags.push(`schema-v${next.schema}`);
  if (prev === null || prev.web !== next.web) tags.push(`web-v${next.web}`);
  if (prev === null || prev.docs !== next.docs) tags.push(`docs-v${next.docs}`);
  return tags;
}

const TAG_SHAPE: Record<Component, RegExp> = {
  engine: /^engine-v\d+\.\d+\.\d+$/,
  input: /^input-census-\d{4}-r\d+$/,
  maps: /^maps-\d+$/,
  schema: /^schema-v\d+\.\d+\.\d+$/,
  web: /^web-v\d+\.\d+\.\d+$/,
  docs: /^docs-v\d+\.\d+\.\d+$/,
};

const numbersIn = (tag: string): number[] => (tag.match(/\d+/g) ?? []).map(Number);

/** The highest release tag of one component (numeric order, so r10 beats r9), or null when it has none. */
export function newestTag(tags: readonly string[], component: Component): string | null {
  let best: string | null = null;
  for (const t of tags) {
    if (!TAG_SHAPE[component].test(t)) continue;
    if (best === null) {
      best = t;
      continue;
    }
    const a = numbersIn(t);
    const b = numbersIn(best);
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const d = (a[i] ?? 0) - (b[i] ?? 0);
      if (d !== 0) {
        if (d > 0) best = t;
        break;
      }
    }
  }
  return best;
}
