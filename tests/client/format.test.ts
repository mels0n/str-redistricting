import { describe, expect, it } from 'vitest';
import { chunkDigest, congressOfSource, formatKm, formatPct, formatPeople, formatSignedPeople, ordinal, peopleNoun } from '../../src/client/shared/lib/format';
import { enactedSourceLabel } from '../../src/client/features/plan-options';

describe('format', () => {
  it('keeps small percentages instead of rounding them to zero', () => {
    expect(formatPct(0.00027711798679324955)).toBe('0.00028%');
    expect(formatPct(-0.0000911, true)).toBe('−0.000091%');
    expect(formatPct(0.5)).toBe('0.5%');
    expect(formatPct(0)).toBe('0%');
    expect(formatPct(1.234)).toBe('1.23%');
  });

  it('formats people with fractions and signs', () => {
    expect(formatPeople(721714.25)).toBe('721,714.25');
    expect(formatPeople(5773714)).toBe('5,773,714');
    expect(formatSignedPeople(-1.25)).toBe('−1.25');
    expect(formatSignedPeople(2)).toBe('+2');
    expect(formatSignedPeople(0)).toBe('0');
    expect(peopleNoun(1)).toBe('person');
    expect(peopleNoun(-1)).toBe('person');
    expect(peopleNoun(2)).toBe('people');
  });

  it('formats lengths in kilometres', () => {
    expect(formatKm(19369)).toBe('19.4 km');
    expect(formatKm(712836)).toBe('712.8 km');
  });

  it('chunks a digest into a fixed-width block', () => {
    const hex = '25829b3f4cd1299e308b366c4ab93f12c5d58ed99dccf10d48ee3b7a369e5247';
    const lines = chunkDigest(hex);
    expect(lines).toHaveLength(4);
    expect(lines[0]).toEqual(['2582', '9b3f', '4cd1', '299e']);
    expect(lines.flat().join('')).toBe(hex);
  });
});

describe('ordinal', () => {
  it('uses st, nd, rd and th, with 11 to 13 always th', () => {
    expect(ordinal(119)).toBe('119th');
    expect(ordinal(121)).toBe('121st');
    expect(ordinal(122)).toBe('122nd');
    expect(ordinal(123)).toBe('123rd');
    expect(ordinal(111)).toBe('111th');
    expect(ordinal(112)).toBe('112th');
    expect(ordinal(113)).toBe('113th');
    expect(ordinal(101)).toBe('101st');
  });
});

describe('enactedSourceLabel', () => {
  it('names the Congress with the right ordinal and keeps the source citation', () => {
    expect(enactedSourceLabel('cb_2025_us_cd119_500k')).toBe('U.S. Census Bureau cartographic boundary file for the 119th Congress (2025 release, cb_2025_us_cd119_500k)');
    expect(enactedSourceLabel('cb_2027_us_cd121_500k')).toContain('121st Congress');
    expect(enactedSourceLabel('weird')).toBe('U.S. Census Bureau boundary file weird');
  });
});

describe('congressOfSource', () => {
  it('reads the Congress from an enacted-districts file name, any digit count', () => {
    expect(congressOfSource('cb_2025_us_cd119_500k')).toBe(119);
    expect(congressOfSource('cb_2031_us_cd1000_500k')).toBe(1000);
  });
  it('rejects names the publisher would reject', () => {
    expect(congressOfSource('cb_2025_us_cd119_20m')).toBeNull();
    expect(congressOfSource('cb_2025_us_cd119_500k.zip')).toBeNull();
    expect(congressOfSource('something else')).toBeNull();
  });
});
