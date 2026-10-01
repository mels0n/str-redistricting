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
  it('rejects unknown states', () => {
    expect(() => parseConfig(['--states', 'XX'])).toThrow(ConfigError);
  });
  it('rejects an angle step that does not divide 180', () => {
    expect(() => parseConfig(['--states', 'CO', '--angle-step', '0.7'])).toThrow(ConfigError);
  });
});
