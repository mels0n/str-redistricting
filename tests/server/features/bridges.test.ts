import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bridgesJson } from '../../../src/server/features/export/index.js';
import { buildPublishedBridges } from '../../../src/server/features/publish/index.js';
import { DataError } from '../../../src/server/shared/errors/index.js';

const A = '440010301001000';
const B = '440010301001001';
const csv = (a: number, b: number) => `GEOID20,district\n${A},${a}\n${B},${b}\n`;

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'bridges-')); mkdirSync(dir, { recursive: true }); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const putLinks = (n = 1) => writeFileSync(join(dir, 'bridges.json'), JSON.stringify({
  links: Array.from({ length: n }, () => ({ a: A, b: B, aPoint: [-71.1234567, 41.5], bPoint: [-71.2, 41.6000004] })),
}));

describe('bridges.json', () => {
  it('the generator writer lists each link with GEOIDs and 6-decimal block points', () => {
    const blocks = [
      { geoid: A, pop: 1, point: [-71.1234567, 41.5] as [number, number], rings: [] },
      { geoid: B, pop: 1, point: [-71.2, 41.6000004] as [number, number], rings: [] },
    ];
    expect(bridgesJson({ bridges: [[0, 1]] } as never, blocks)).toEqual({ links: [{ a: A, b: B, aPoint: [-71.123457, 41.5], bPoint: [-71.2, 41.6] }] });
    expect(bridgesJson({ bridges: [] } as never, blocks)).toEqual({ links: [] });
  });

  it('is empty when metrics report no links, without needing the out file', async () => {
    expect(await buildPublishedBridges(dir, 'RI', 0, csv(1, 2), csv(1, 2))).toEqual({ links: [] });
  });

  it('fails and names the state when links are reported but the file is missing', async () => {
    await expect(buildPublishedBridges(dir, 'RI', 1, csv(1, 2), csv(1, 2))).rejects.toThrow(DataError);
    await expect(buildPublishedBridges(dir, 'RI', 1, csv(1, 2), csv(1, 2))).rejects.toThrow(/re-run explore for RI/);
  });

  it('turns a syntax error in the file into a DataError naming the state', async () => {
    writeFileSync(join(dir, 'bridges.json'), '{ not json');
    await expect(buildPublishedBridges(dir, 'RI', 1, csv(1, 2), csv(1, 2))).rejects.toThrow(/not valid JSON; re-run explore for RI/);
  });

  it('fails when the file holds a different number of links than metrics', async () => {
    putLinks(2);
    await expect(buildPublishedBridges(dir, 'RI', 1, csv(1, 2), csv(1, 2))).rejects.toThrow(DataError);
  });

  it('looks up the district of each end under each plan', async () => {
    putLinks();
    const out = await buildPublishedBridges(dir, 'RI', 1, csv(1, 2), csv(2, 2));
    expect(out).toEqual({ links: [{ a: [-71.123457, 41.5], b: [-71.2, 41.6], finished: [1, 2], before: [2, 2] }] });
  });

  it('fails when an end is not in the assignment', async () => {
    putLinks();
    await expect(buildPublishedBridges(dir, 'RI', 1, `GEOID20,district\n${A},1\n`, csv(1, 2))).rejects.toThrow(DataError);
  });
  it('unwraps positive longitudes for a state that crosses the antimeridian, and leaves others alone', async () => {
    writeFileSync(join(dir, 'bridges.json'), JSON.stringify({ links: [{ a: A, b: B, aPoint: [172.9, 52.9], bPoint: [-170.5, 53] }] }));
    const ak = await buildPublishedBridges(dir, 'AK', 1, csv(1, 2), csv(1, 2));
    expect(ak.links[0]!.a).toEqual([172.9 - 360, 52.9]);
    expect(ak.links[0]!.b).toEqual([-170.5, 53]);
    const other = await buildPublishedBridges(dir, 'RI', 1, csv(1, 2), csv(1, 2));
    expect(other.links[0]!.a).toEqual([172.9, 52.9]);
  });
});
