import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { detailSource } from '../../src/client/widgets/district-map/detail';

/** The client cannot import the publisher, so read its zoom constants from the source. */
const published = (name: string): number => {
  const text = readFileSync('src/server/features/publish/tiles.ts', 'utf8');
  const m = new RegExp(String.raw`export const ${name} = ([0-9]+);`).exec(text);
  if (!m) throw new Error(`${name} not found`);
  return Number(m[1]);
};

describe('detail source zooms', () => {
  it('match the zooms the publisher writes', () => {
    const src = detailSource('CO');
    expect([src.minzoom, src.maxzoom]).toEqual([published('TILE_MINZOOM'), published('TILE_MAXZOOM')]);
  });
});
