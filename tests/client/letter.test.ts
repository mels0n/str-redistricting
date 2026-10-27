import { describe, expect, it } from 'vitest';
import { letterText } from '../../src/client/widgets/rep-panel';
import type { Rep } from '../../src/client/entities/reps';

const rep: Rep = { id: 'x', name: 'Joe Neguse', office: 'us-house', districtCode: '02', contactUrl: null, email: null, phone: null, address: null, website: null, social: {} };

describe('letterText', () => {
  const l = letterText({ rep, office: 'us-house', stateName: 'Colorado', districtLabel: 'U.S. House, CO-02', mapUrl: 'https://example.org/co' });
  it('has the subject and the pledge sentence verbatim', () => {
    expect(l.subject).toBe('Please support the Fair Maps rule for Colorado');
    expect(l.body).toContain(
      'I live in U.S. House, CO-02. I am asking you to support drawing Colorado’s districts with the Fair Maps rule: split the state along the shortest line that divides its people evenly, repeat until each piece is one district, and publish the code so anyone can check the result.',
    );
    expect(l.body.startsWith('Dear Joe Neguse,\n\n')).toBe(true);
    expect(l.body.endsWith('Thank you,')).toBe(true);
  });
  it('links the map and has no em dash', () => {
    expect(l.body).toContain('at https://example.org/co.');
    expect(l.subject + l.body).not.toContain('—');
  });
});
