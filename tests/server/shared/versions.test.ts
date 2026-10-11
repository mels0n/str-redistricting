import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { VERSIONS, VersionsSchema, formatVersions, inputSha256Of, stampOf } from '../../../src/server/shared/config/index.js';

const manifestText = readFileSync('config/census-sha256.json', 'utf8');
const enactedText = readFileSync('config/enacted.json', 'utf8');
const legislativeText = readFileSync('config/legislative-districts.json', 'utf8');

describe('versions config', () => {
  it('parses and holds well-formed values', () => {
    expect(VersionsSchema.parse(VERSIONS)).toEqual(VERSIONS);
    expect(VERSIONS.maps).toBeGreaterThanOrEqual(1);
    expect(VERSIONS.input.revision).toBeGreaterThanOrEqual(1);
    expect(VERSIONS.input.vintage).toMatch(/^census-\d{4}$/);
  });

  it('keeps input.sha256 in step with the census manifest and enacted config', () => {
    expect(
      inputSha256Of(manifestText, enactedText, legislativeText),
      'config/census-sha256.json, config/enacted.json or config/legislative-districts.json changed: bump input.revision and update input.sha256 in config/versions.json (npm run release does both)',
    ).toBe(VERSIONS.input.sha256);
  });

  it('ignores whitespace and changes with a hash value', () => {
    const base = inputSha256Of(manifestText, enactedText, legislativeText);
    const compactManifest = JSON.stringify(JSON.parse(manifestText));
    const spacedEnacted = JSON.stringify(JSON.parse(enactedText), null, 8);
    const spacedLegislative = JSON.stringify(JSON.parse(legislativeText), null, 8);
    expect(inputSha256Of(compactManifest, spacedEnacted, spacedLegislative)).toBe(base);

    const manifest = JSON.parse(manifestText) as Record<string, string>;
    const first = Object.keys(manifest)[0]!;
    manifest[first] = (manifest[first]![0] === '0' ? '1' : '0') + manifest[first]!.slice(1);
    expect(inputSha256Of(JSON.stringify(manifest), enactedText, legislativeText)).not.toBe(base);

    // A changed district count moves the fingerprint, so a recount cannot pass as "no input change".
    const counts = JSON.parse(legislativeText) as { states: Record<string, Record<string, number>> };
    counts.states.CO!['state-house'] = counts.states.CO!['state-house']! + 1;
    expect(inputSha256Of(manifestText, enactedText, JSON.stringify(counts))).not.toBe(base);
  });

  it('stampOf drops web and docs', () => {
    const stamp = stampOf(VERSIONS);
    expect(stamp).toEqual({ engine: VERSIONS.engine, input: VERSIONS.input, maps: VERSIONS.maps, schema: VERSIONS.schema });
    expect(Object.keys(stamp)).not.toContain('web');
    expect(Object.keys(stamp)).not.toContain('docs');
  });

  it('formatVersions round-trips through the schema', () => {
    const text = formatVersions(VERSIONS);
    expect(text.endsWith('\n')).toBe(true);
    expect(VersionsSchema.parse(JSON.parse(text))).toEqual(VERSIONS);
  });

  it('rejects malformed versions', () => {
    expect(() => VersionsSchema.parse({ ...VERSIONS, engine: '1.0' })).toThrow();
    expect(() => VersionsSchema.parse({ ...VERSIONS, maps: 0 })).toThrow();
    expect(() => VersionsSchema.parse({ ...VERSIONS, extra: 1 })).toThrow();
    expect(() => VersionsSchema.parse({ ...VERSIONS, input: { ...VERSIONS.input, vintage: 'census-20' } })).toThrow();
  });
});
