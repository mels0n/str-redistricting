import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LOCK_FILE, readJsonRetrying, withDirLock, writeAtomic } from '../../../src/server/features/publish/safe-write.js';
import { DataError } from '../../../src/server/shared/errors/index.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'safe-write-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('writeAtomic', () => {
  it('replaces the file and leaves no temporary file behind', async () => {
    const path = join(dir, 'a.json');
    await writeAtomic(path, 'one');
    await writeAtomic(path, 'two');
    expect(readFileSync(path, 'utf8')).toBe('two');
    expect(readdirSync(dir)).toEqual(['a.json']);
  });
  it('lets concurrent writers of one file finish with one writer\'s whole content', async () => {
    const path = join(dir, 'a.json');
    const bodies = Array.from({ length: 8 }, (_, i) => String(i).repeat(100_000));
    await Promise.all(bodies.map((b) => writeAtomic(path, b)));
    expect(bodies).toContain(readFileSync(path, 'utf8'));
    expect(readdirSync(dir)).toEqual(['a.json']);
  });
});

describe('withDirLock', () => {
  it('serialises read-modify-write sections, so concurrent rebuilds both land', async () => {
    const path = join(dir, 'index.json');
    writeFileSync(path, '[]');
    const add = (item: string) => withDirLock(dir, async () => {
      const list = JSON.parse(readFileSync(path, 'utf8')) as string[];
      await delay(20);
      await writeAtomic(path, JSON.stringify([...list, item]));
    });
    await Promise.all([add('a'), add('b'), add('c')]);
    expect((JSON.parse(readFileSync(path, 'utf8')) as string[]).sort()).toEqual(['a', 'b', 'c']);
    expect(existsSync(join(dir, LOCK_FILE))).toBe(false);
  });
  it('releases the lock when the section throws', async () => {
    await expect(withDirLock(dir, async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(existsSync(join(dir, LOCK_FILE))).toBe(false);
    await expect(withDirLock(dir, async () => 'ok')).resolves.toBe('ok');
  });
  it('takes over a stale lock left by a run that died', async () => {
    const lock = join(dir, LOCK_FILE);
    writeFileSync(lock, '123\n');
    const old = new Date(Date.now() - 60 * 60_000);
    utimesSync(lock, old, old);
    await expect(withDirLock(dir, async () => 'ok', { staleMs: 10 * 60_000 })).resolves.toBe('ok');
    expect(existsSync(lock)).toBe(false);
  });
  it('fails, leaving the other run\'s lock alone, when a live lock is held past the timeout', async () => {
    const lock = join(dir, LOCK_FILE);
    writeFileSync(lock, '123\n');
    await expect(withDirLock(dir, async () => 'no', { staleMs: 60 * 60_000, timeoutMs: 50, sleep: (ms) => delay(Math.min(ms, 10)) })).rejects.toBeInstanceOf(DataError);
    expect(existsSync(lock)).toBe(true);
  });
});

describe('readJsonRetrying', () => {
  it('reads again once after a failed read', async () => {
    let calls = 0;
    const got = await readJsonRetrying(async () => {
      if (++calls === 1) throw new SyntaxError('torn');
      return { ok: true };
    }, async () => undefined);
    expect(got).toEqual({ ok: true });
    expect(calls).toBe(2);
  });
  it('gives up after the second failure', async () => {
    let calls = 0;
    await expect(readJsonRetrying(async () => { calls++; throw new Error('gone'); }, async () => undefined)).rejects.toThrow('gone');
    expect(calls).toBe(2);
  });
});
