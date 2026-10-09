import { describe, expect, it, vi } from 'vitest';
import { reloadOncePerRelease } from '../../src/client/app/skew-reload';

const memory = (): Storage => {
  const map = new Map<string, string>();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) } as Storage;
};

describe('reloadOncePerRelease', () => {
  it('reloads on the first call and stores the release', () => {
    const store = memory();
    const reload = vi.fn();
    reloadOncePerRelease(() => store, reload)(8);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(store.getItem('strv-skew-reload')).toBe('8');
  });

  it('does nothing for the same release again, even from a fresh handler on the same storage', () => {
    const store = memory();
    const reload = vi.fn();
    reloadOncePerRelease(() => store, reload)(8);
    reloadOncePerRelease(() => store, reload)(8);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reloads again for a newer release', () => {
    const store = memory();
    const reload = vi.fn();
    const handler = reloadOncePerRelease(() => store, reload);
    handler(8);
    handler(9);
    expect(reload).toHaveBeenCalledTimes(2);
    expect(store.getItem('strv-skew-reload')).toBe('9');
  });

  it('does not reload when storage is unavailable or throws', () => {
    const reload = vi.fn();
    reloadOncePerRelease(() => { throw new Error('denied'); }, reload)(8);
    const noRead = { getItem: () => { throw new Error('denied'); }, setItem: () => undefined } as unknown as Storage;
    reloadOncePerRelease(() => noRead, reload)(8);
    const noWrite = { getItem: () => null, setItem: () => { throw new Error('full'); } } as unknown as Storage;
    reloadOncePerRelease(() => noWrite, reload)(8);
    expect(reload).not.toHaveBeenCalled();
  });
});
