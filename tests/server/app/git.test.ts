import { describe, expect, it } from 'vitest';
import { changedFiles, commitsSince, mergeBase, showFile } from '../../../src/server/app/git.js';
import { ConfigError } from '../../../src/server/shared/errors/index.js';

describe('git helpers', () => {
  it('refuse a ref that git would read as an option', () => {
    expect(() => showFile('--output=x', 'package.json')).toThrow(ConfigError);
    expect(() => mergeBase('--output=x', 'HEAD')).toThrow(ConfigError);
    expect(() => mergeBase('HEAD', '-x')).toThrow(ConfigError);
    expect(() => changedFiles('--output=x', 'HEAD')).toThrow(ConfigError);
    expect(() => changedFiles('HEAD', '--output=x')).toThrow(ConfigError);
    expect(() => commitsSince('--output=x')).toThrow(ConfigError);
  });
  it('still read ordinary refs after --end-of-options', () => {
    expect(showFile('HEAD', 'package.json')).toContain('"name"');
    expect(showFile('HEAD', 'no-such-file.txt')).toBeNull();
    expect(mergeBase('HEAD', 'HEAD')).toMatch(/^[0-9a-f]{40}$/);
    expect(changedFiles('HEAD', 'HEAD')).toEqual([]);
    expect(commitsSince('HEAD')).toEqual([]);
    expect(commitsSince(null).length).toBeGreaterThan(0);
  });
});
