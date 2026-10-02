import { availableParallelism } from 'node:os';
import { describe, expect, it } from 'vitest';
import { parseConfig } from '../../../src/server/shared/config/index.js';
import { ConfigError } from '../../../src/server/shared/errors/index.js';

describe('parseConfig', () => {
  it('parses states and angle step', () => {
    const c = parseConfig(['--states', 'CO,md', '--angle-step', '0.5']);
    expect(c.states.map((s) => s.abbr)).toEqual(['CO', 'MD']);
    expect(c.angleStepDeg).toBe(0.5);
    expect(c.cacheDir).toBe('data/raw');
    expect(c.outDir).toBe('out');
  });
  it('defaults the angle step to 0.1', () => {
    expect(parseConfig(['--states', 'CO']).angleStepDeg).toBe(0.1);
  });
  it('rejects unknown states', () => {
    expect(() => parseConfig(['--states', 'XX'])).toThrow(ConfigError);
  });
  it('rejects an angle step that does not divide 180', () => {
    expect(() => parseConfig(['--states', 'CO', '--angle-step', '0.7'])).toThrow(ConfigError);
  });
  it('defaults threads to the hardware threads minus two, at least one', () => {
    expect(parseConfig(['--states', 'CO']).threads).toBe(Math.max(1, availableParallelism() - 2));
    expect(parseConfig(['--states', 'CO', '--threads', '1']).threads).toBe(1);
    expect(parseConfig(['--states', 'CO', '--threads', '6']).threads).toBe(6);
  });
  it('rejects a thread count that is not a positive whole number', () => {
    for (const t of ['0', '-2', '1.5', 'many']) expect(() => parseConfig(['--states', 'CO', `--threads=${t}`])).toThrow(ConfigError);
  });
});
