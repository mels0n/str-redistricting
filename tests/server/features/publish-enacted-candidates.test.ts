import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DataError, DownloadError } from '../../../src/server/shared/errors/index.js';

const dl = vi.hoisted(() => ({ requested: [] as string[], impl: async (_file: string): Promise<string> => '' }));

vi.mock('../../../src/server/shared/http/index.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  downloadCached: (_url: string, _path: string, label: string) => {
    dl.requested.push(label);
    return dl.impl(label);
  },
}));
vi.mock('adm-zip', () => ({
  default: class {
    getEntries() {
      return ['.shp', '.dbf'].map((ext) => ({ entryName: `x${ext}`, getData: () => Buffer.alloc(0) }));
    }
  },
}));
vi.mock('shapefile', () => ({
  open: async () => {
    let done = false;
    return {
      read: async () => {
        if (done) return { done: true };
        done = true;
        return { done: false, value: { properties: { STATEFP: '44', NAMELSAD: 'Congressional District 1', CD119FP: '01' }, geometry: null } };
      },
    };
  },
}));

const { ENACTED_CANDIDATES, ENACTED_CONGRESS, loadEnacted } = await import('../../../src/server/features/publish/boundary.js');

const notFound = (): Promise<never> => Promise.reject(new DownloadError('HTTP 404', 404));

beforeEach(() => {
  dl.requested = [];
});

describe('loadEnacted', () => {
  it('has at least two vintages to fall through', () => {
    expect(ENACTED_CANDIDATES.length).toBeGreaterThan(1);
  });
  it('moves past a 404 to the next vintage of the same Congress', async () => {
    dl.impl = (file) => (file === ENACTED_CANDIDATES[0] ? notFound() : Promise.resolve('z'));
    const out = await loadEnacted('cache');
    expect(out.source).toBe(ENACTED_CANDIDATES[1]);
    expect(out.features).toHaveLength(1);
    expect(dl.requested).toEqual(ENACTED_CANDIDATES.slice(0, 2));
  });
  it('rethrows a non-404 failure instead of trying the next vintage', async () => {
    dl.impl = () => Promise.reject(new DownloadError('HTTP 500', 500));
    await expect(loadEnacted('cache')).rejects.toMatchObject({ status: 500 });
    expect(dl.requested).toEqual([ENACTED_CANDIDATES[0]]);
  });
  it('fails naming the Congress when every vintage is 404, requesting only the candidates', async () => {
    dl.impl = notFound;
    const err = await loadEnacted('cache').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DataError);
    expect((err as Error).message).toContain(`Congress ${ENACTED_CONGRESS}`);
    expect(dl.requested).toEqual([...ENACTED_CANDIDATES]);
  });
});
