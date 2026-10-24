// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  delete (globalThis as { STR_VIEWER_CONFIG?: unknown }).STR_VIEWER_CONFIG;
  vi.resetModules();
});

async function routingWith(host: unknown): Promise<string> {
  if (host !== undefined) (globalThis as { STR_VIEWER_CONFIG?: unknown }).STR_VIEWER_CONFIG = host;
  vi.resetModules();
  return (await import('../../src/client/shared/config')).config.routing;
}

describe('default routing', () => {
  it('uses real paths when no host config is set', async () => {
    expect(await routingWith(undefined)).toBe('path');
  });
  it('stays in hash mode for an embedder that sets only dataBase', async () => {
    expect(await routingWith({ dataBase: 'https://x.test/data/' })).toBe('hash');
  });
  it('stays in hash mode when the host config is present but invalid', async () => {
    expect(await routingWith({ routing: 'Hash' })).toBe('hash');
    expect(await routingWith('nonsense')).toBe('hash');
  });
  it('lets an embedder opt in to paths', async () => {
    expect(await routingWith({ routing: 'path' })).toBe('path');
  });
});
