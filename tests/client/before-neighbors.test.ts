// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** What the stubbed server answers for before-neighbors.json: a body, or null for a 404. */
let neighborsBody: unknown;

beforeEach(() => {
  vi.resetModules();
  neighborsBody = null;
  vi.stubGlobal('fetch', (url: string) => {
    const path = new URL(String(url)).pathname.replace(/^.*\/data\//, '');
    if (path.endsWith('before-neighbors.json')) {
      return Promise.resolve(neighborsBody === null ? new Response('no', { status: 404 }) : new Response(JSON.stringify(neighborsBody)));
    }
    try {
      return Promise.resolve(new Response(readFileSync(`public/data/${path}`)));
    } catch {
      return Promise.resolve(new Response('no', { status: 404 }));
    }
  });
});
afterEach(() => vi.unstubAllGlobals());

async function modules() {
  const plan = await import('../../src/client/entities/plan');
  const { districtPalette } = await import('../../src/client/shared');
  const hexes = (neighbors: number[][]): string[] => plan.assignColors(neighbors, districtPalette.length).map((s) => districtPalette[s]!.hex);
  return { ...plan, hexes };
}

/** A neighbor list that ties district 1 to every other district, unlike any real plan's. */
const star = (seats: number): number[][] => Array.from({ length: seats }, (_, i) => (i === 0 ? Array.from({ length: seats - 1 }, (_, k) => k + 1) : [0]));

describe('district colors with before-neighbors.json', () => {
  it('are computed from both plans at first paint and do not change when the before plan loads', async () => {
    const seats = (await (await modules()).loadStateBundle('CO')).finished.features.length;
    vi.resetModules();
    neighborsBody = { neighbors: star(seats) };
    const m = await modules();
    const bundle = await m.loadStateBundle('CO');
    expect(bundle.colors).toEqual(m.hexes(m.unionNeighbors(bundle.finished.neighbors, star(seats))));
    const first = [...bundle.colors];
    await m.loadBefore('CO');
    expect(bundle.before).not.toBeNull();
    expect(bundle.colors).toEqual(first);
  });

  it('fall back to the finished map alone, then both plans after the before plan loads, when the file is missing', async () => {
    const m = await modules();
    const bundle = await m.loadStateBundle('CO');
    expect(bundle.colors).toEqual(m.hexes(bundle.finished.neighbors));
    await m.loadBefore('CO');
    expect(bundle.colors).toEqual(m.hexes(m.unionNeighbors(bundle.finished.neighbors, bundle.before!.neighbors)));
  });

  it('are treated as absent, without failing the page, when the file is unreadable or the wrong size', async () => {
    neighborsBody = { neighbors: [[1], [0]] };
    const m = await modules();
    const bundle = await m.loadStateBundle('CO');
    expect(bundle.colors).toEqual(m.hexes(bundle.finished.neighbors));
    vi.resetModules();
    neighborsBody = { nope: true };
    const again = await modules();
    const b2 = await again.loadStateBundle('CO');
    expect(b2.colors).toEqual(again.hexes(b2.finished.neighbors));
  });
});
