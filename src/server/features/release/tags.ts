import type { Versions } from '../../shared/config/index.js';
import type { TaggedVersions } from './bump.js';
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

/** The shape of an input tag, with the vintage and revision captured; the tag shape and the vintage read-back both use it. */
const INPUT_TAG = /^input-(census-\d{4})-r(\d+)$/;

const TAG_SHAPE: Record<Component, RegExp> = {
  engine: /^engine-v\d+\.\d+\.\d+$/,
  input: INPUT_TAG,
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

/** The versions the newest tags name (a component with no tag is left out). */
export function taggedVersions(newest: Readonly<Record<Component, string | null>>): TaggedVersions {
  const out: TaggedVersions = {};
  const semver = (tag: string | null): string | undefined => /-v(\d+\.\d+\.\d+)$/.exec(tag ?? '')?.[1];
  const trailing = (tag: string | null, re: RegExp): number | undefined => {
    const m = re.exec(tag ?? '');
    return m === null ? undefined : Number(m[1]);
  };
  const engine = semver(newest.engine);
  if (engine !== undefined) out.engine = engine;
  const inputVintage = INPUT_TAG.exec(newest.input ?? '')?.[1];
  if (inputVintage !== undefined) out.inputVintage = inputVintage;
  const inputRevision = trailing(newest.input, /-r(\d+)$/);
  if (inputRevision !== undefined) out.inputRevision = inputRevision;
  const maps = trailing(newest.maps, /^maps-(\d+)$/);
  if (maps !== undefined) out.maps = maps;
  for (const c of ['schema', 'web', 'docs'] as const) {
    const v = semver(newest[c]);
    if (v !== undefined) out[c] = v;
  }
  return out;
}
