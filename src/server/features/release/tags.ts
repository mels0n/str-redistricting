import type { Versions } from '../../shared/config/index.js';

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
