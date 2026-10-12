import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stateByAbbr } from '../../../src/server/shared/apportionment/index.js';
import { DataError } from '../../../src/server/shared/errors/index.js';

const tileMocks = vi.hoisted(() => ({
  districtsAtDeepTile: vi.fn(),
  deepSamplePoint: vi.fn(),
}));
vi.mock('../../../src/server/features/publish/tiles.js', async (orig) => ({
  ...(await orig<typeof import('../../../src/server/features/publish/tiles.js')>()),
  districtsAtDeepTile: tileMocks.districtsAtDeepTile,
  deepSamplePoint: tileMocks.deepSamplePoint,
}));

const { verifyTiles } = await import('../../../src/server/features/publish/publish.js');
const { encodeBlocks } = await import('../../../src/server/features/publish/blocks.js');

const VT = stateByAbbr('VT')!;
const FP = { finished: 'a'.repeat(64), before: 'b'.repeat(64) };
const geoid = (i: number): string => `50001${String(100000 + Math.floor(i / 1000))}${String(i % 1000).padStart(4, '0')}`;
const blocks = (n: number) => Array.from({ length: n }, (_, i) => ({ geoid: geoid(i), pop: 1, point: [-72 - i / 1e5, 44] as [number, number], rings: [] }));
const fileFor = (n: number) => {
  const csv = `GEOID20,district\n${Array.from({ length: n }, (_, i) => `${geoid(i)},1`).join('\n')}\n`;
  return encodeBlocks('50', 1, csv, csv, FP);
};

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  tileMocks.deepSamplePoint.mockImplementation((_r: unknown, p: [number, number]) => p);
  tileMocks.districtsAtDeepTile.mockImplementation(async (_t: unknown, _l: string, points: unknown[]) => points.map(() => 1));
});
afterEach(() => {
  vi.restoreAllMocks();
  tileMocks.districtsAtDeepTile.mockReset();
  tileMocks.deepSamplePoint.mockReset();
});

describe('verifyTiles', () => {
  it('passes when every sampled block lands in its district', async () => {
    await expect(verifyTiles(VT, blocks(50), new Uint8Array(), fileFor(50), new Set(), false)).resolves.toBeUndefined();
  });

  it('refuses a tile that disagrees with the assignment, naming the block', async () => {
    // Points come back in sampled order, so the third block's lookup is wrong.
    tileMocks.districtsAtDeepTile.mockImplementation(async (_t: unknown, layer: string, points: unknown[]) => points.map((_, j) => (layer === 'finished' && j === 2 ? 2 : 1)));
    const run = verifyTiles(VT, blocks(50), new Uint8Array(), fileFor(50), new Set(), false);
    await expect(run).rejects.toBeInstanceOf(DataError);
    await expect(run).rejects.toThrow(`${geoid(2)} finished: tile 2, assignment 1`);
  });

  it('checks a moved block that falls between the sampling stride', async () => {
    // 4001 blocks give a stride of 2: block 1 is not on it, so only the moved set puts it in the sample.
    const all = blocks(4001);
    const file = fileFor(4001);
    const checked: unknown[][] = [];
    tileMocks.districtsAtDeepTile.mockImplementation(async (_t: unknown, layer: string, points: unknown[]) => {
      if (layer === 'finished') checked.push(points);
      return points.map(() => 1);
    });
    tileMocks.deepSamplePoint.mockImplementation((_r: unknown, p: [number, number]) => p);
    await verifyTiles(VT, all, new Uint8Array(), file, new Set(), false);
    const without = checked.flat().length;
    checked.length = 0;
    await verifyTiles(VT, all, new Uint8Array(), file, new Set([geoid(1)]), false);
    expect(checked.flat().length).toBe(without + 1);
  });

  it('reports a thin block that was skipped, and names a thin moved block', async () => {
    const all = blocks(300);
    const only = all[7]!;
    tileMocks.deepSamplePoint.mockImplementation((_r: unknown, p: [number, number]) => (p[0] === only.point[0] ? null : p));
    await expect(verifyTiles(VT, all, new Uint8Array(), fileFor(300), new Set([only.geoid]), false)).resolves.toBeUndefined();
    const line = vi.mocked(console.log).mock.calls.map((c) => String(c[0])).find((l) => l.includes('too thin'));
    expect(line).toContain('1 of 300');
    expect(line).toContain('moved by balancing');
    expect(line).toContain(only.geoid);
  });

  it('refuses when more than 1% of the sampled blocks are too thin', async () => {
    const all = blocks(100);
    const thin = new Set(all.slice(0, 5).map((b) => b.point[0]));
    tileMocks.deepSamplePoint.mockImplementation((_r: unknown, p: [number, number]) => (thin.has(p[0]) ? null : p));
    await expect(verifyTiles(VT, all, new Uint8Array(), fileFor(100), new Set(), false)).rejects.toThrow(/5 of 100 sampled blocks are too thin/);
  });

  it('refuses when no sampled block could be checked', async () => {
    tileMocks.deepSamplePoint.mockImplementation(() => null);
    await expect(verifyTiles(VT, blocks(20), new Uint8Array(), fileFor(20), new Set(), false)).rejects.toThrow(/no sampled block could be checked/);
    expect(tileMocks.districtsAtDeepTile).not.toHaveBeenCalled();
  });
});
