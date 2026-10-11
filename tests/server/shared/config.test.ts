import { availableParallelism } from 'node:os';
import { describe, expect, it } from 'vitest';
import { defaultThreads, LINE_SEARCH, parseConfig, parseRuleExamplesConfig } from '../../../src/server/shared/config/index.js';
import { CheckFailedError, ConfigError, DataError, exitCodeFor, WorkerPoolError } from '../../../src/server/shared/errors/index.js';

describe('parseConfig', () => {
  it('parses states', () => {
    const c = parseConfig(['--states', 'CO,md']);
    expect(c.states.map((s) => s.abbr)).toEqual(['CO', 'MD']);
    expect(c.cacheDir).toBe('data/raw');
    expect(c.outDir).toBe('out');
  });
  it('redraws unchanged states only with --force', () => {
    expect(parseConfig(['--states', 'CO']).force).toBe(false);
    expect(parseConfig(['--states', 'CO', '--force']).force).toBe(true);
  });
  it('rejects unknown states', () => {
    expect(() => parseConfig(['--states', 'XX'])).toThrow(ConfigError);
  });
  it('says --states is required when it is missing', () => {
    expect(() => parseConfig([])).toThrow(ConfigError);
    expect(() => parseConfig([])).toThrow(/--states is required .*for example CO or RI,CT/);
    expect(() => parseConfig(['--states', ''])).toThrow(/--states is required/);
  });
  it('has no angle step option: the cut search covers every straight line', () => {
    expect(() => parseConfig(['--states', 'CO', '--angle-step', '0.5'])).toThrow();
    expect(LINE_SEARCH).toBe('exact');
  });
  it('defaults threads to the hardware threads minus two, at most one per 400 MiB free, at least one', () => {
    // Free memory moves between reads, so the default lies between the values read just before and just after.
    const within = (read: () => number) => {
      const before = defaultThreads(), t = read(), after = defaultThreads();
      expect(t).toBeGreaterThanOrEqual(Math.min(before, after));
      expect(t).toBeLessThanOrEqual(Math.max(before, after));
      expect(t).toBeLessThanOrEqual(Math.max(1, availableParallelism() - 2));
    };
    within(() => parseConfig(['--states', 'CO']).threads);
    within(() => parseRuleExamplesConfig([]).threads);
    expect(parseConfig(['--states', 'CO', '--threads', '1']).threadsLimitedByMemory).toBe(false);
    const MiB = 1024 * 1024;
    expect(defaultThreads(16, 100 * 1024 * MiB)).toBe(14);
    expect(defaultThreads(16, 10 * 400 * MiB)).toBe(10);
    expect(defaultThreads(16, 10 * 400 * MiB - 1)).toBe(9);
    expect(defaultThreads(16, 100 * MiB)).toBe(1);
    expect(defaultThreads(2, 100 * 1024 * MiB)).toBe(1);
    expect(parseConfig(['--states', 'CO', '--threads', '1']).threads).toBe(1);
    expect(parseConfig(['--states', 'CO', '--threads', '6']).threads).toBe(6);
  });
  it('rejects a thread count that is not a positive whole number', () => {
    for (const t of ['0', '-2', '1.5', 'many']) expect(() => parseConfig(['--states', 'CO', `--threads=${t}`])).toThrow(ConfigError);
  });
  it('has no stray rule option', () => {
    expect(() => parseConfig(['--states', 'CO', '--stray-rule', 'recount'])).toThrow();
  });
});

describe('exitCodeFor', () => {
  it('maps each typed error to its exit code', () => {
    expect(exitCodeFor(new ConfigError('x'))).toBe(2);
    expect(exitCodeFor(new DataError('x'))).toBe(3);
    // A lost worker pool is the run's own fault, not a configuration or data problem.
    expect(exitCodeFor(new WorkerPoolError('x'))).toBe(1);
    expect(exitCodeFor(new CheckFailedError('x'))).toBe(1);
    expect(exitCodeFor(new Error('x'))).toBe(1);
  });
});
