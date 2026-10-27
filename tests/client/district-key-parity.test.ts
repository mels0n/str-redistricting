import { describe, expect, it } from 'vitest';
import { districtKey as serverKey } from '../../src/server/features/reps';
import { districtKey as clientKey } from '../../src/client/shared';

describe('districtKey parity', () => {
  it('gives the same string on both sides', () => {
    const inputs = [
      ['CO', 'us-house', '03'],
      ['CO', 'us-senate', 'state'],
      ['CO', 'state-house', '012'],
      ['NE', 'state-senate', '49'],
      ['AK', 'us-house', '00'],
      ['VT', 'state-house', 'Addison-1'],
      ['NH', 'state-house', '400'],
      ['TX', 'state-senate', '31'],
      ['WY', 'us-senate', 'state'],
      ['DC', 'state-house', '8'],
    ] as const;
    for (const [s, o, c] of inputs) expect(clientKey(s, o, c)).toBe(serverKey(s, o, c));
  });
});
