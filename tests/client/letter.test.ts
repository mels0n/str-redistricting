import { describe, expect, it } from 'vitest';
import { districtPhrase, letterText, groupLetterText } from '../../src/client/widgets/take-action';
import type { Rep } from '../../src/client/entities/reps';

const rep: Rep = { id: 'x', name: 'Joe Neguse', office: 'us-house', districtCode: '02', contactUrl: null, email: null, phone: null, address: null, website: null, social: {} };

describe('letterText', () => {
  const l = letterText({ rep, office: 'us-house', stateName: 'Colorado', districtCode: '02', mapUrl: 'https://example.org/co' });
  it('has the subject and the pledge sentence verbatim', () => {
    expect(l.subject).toBe('Please support the Fair Maps rule for Colorado');
    expect(l.body).toContain(
      'I live in Colorado’s 2nd congressional district. I am asking you to support drawing Colorado’s districts with the Fair Maps rule: split the state along the shortest line that divides its people evenly, repeat until each piece is one district, and publish the code so anyone can check the result.',
    );
    expect(l.body.startsWith('Dear Joe Neguse,\n\n')).toBe(true);
    expect(l.body.endsWith('Thank you,')).toBe(true);
  });
  it('links the map and has no em dash', () => {
    expect(l.body).toContain('at https://example.org/co.');
    expect(l.subject + l.body).not.toContain('—');
  });
});

describe('districtPhrase', () => {
  it.each([
    ['us-senate', '', 'Colorado'],
    ['us-house', '02', 'Colorado’s 2nd congressional district'],
    ['us-house', '11', 'Colorado’s 11th congressional district'],
    ['us-house', '00', 'Colorado'],
    ['state-senate', '012', 'Colorado State Senate district 12'],
    ['state-house', '004', 'Colorado State House district 4'],
    ['state-house', 'CHI', 'Colorado State House district CHI'],
  ] as const)('%s %s', (office, code, phrase) => {
    expect(districtPhrase('Colorado', office, code)).toBe(phrase);
    const l = letterText({ rep, office, stateName: 'Colorado', districtCode: code, mapUrl: 'https://example.org/co' });
    expect(l.body).toContain(`I live in ${phrase}. I am asking you to support drawing Colorado’s districts with the Fair Maps rule`);
  });
});

describe('groupLetterText', () => {
  const mapUrl = 'https://example.org/co';
  it('addresses all representatives and names the state and each district once', () => {
    const l = groupLetterText({ stateName: 'Colorado', mapUrl, places: [{ office: 'state-senate', code: '031' }, { office: 'state-house', code: '006' }, { office: 'us-house', code: '01' }] });
    expect(l.subject).toBe('Please support the Fair Maps rule for Colorado');
    expect(l.body.startsWith('Dear Representatives,' + String.fromCharCode(10).repeat(2))).toBe(true);
    expect(l.body).toContain('I live in Colorado State Senate district 31, Colorado State House district 6 and Colorado’s 1st congressional district. I am asking you to support drawing Colorado’s districts with the Fair Maps rule');
    expect(l.body).toContain('at https://example.org/co.');
    expect(l.body.endsWith('Thank you,')).toBe(true);
    expect(l.subject + l.body).not.toContain('—');
  });
  it('says only the state when no district was found, and drops the state beside real districts', () => {
    expect(groupLetterText({ stateName: 'Colorado', mapUrl, places: [] }).body).toContain('I live in Colorado. I am asking');
    expect(groupLetterText({ stateName: 'Alaska', mapUrl, places: [{ office: 'us-house', code: '00' }, { office: 'state-senate', code: '004' }] }).body).toContain('I live in Alaska State Senate district 4. I am asking');
  });
});
