import { describe, expect, it } from 'vitest';
import { formatHash, parseHash, stateRoute, NATIONAL } from '../../src/client/shared/lib/route';

describe('hash routes', () => {
  it('parses the national index', () => {
    expect(parseHash('')).toEqual(NATIONAL);
    expect(parseHash('#/')).toEqual(NATIONAL);
    expect(parseHash('#/nonsense-path')).toEqual(NATIONAL);
  });

  it('parses a state, a district, a cut and view options', () => {
    expect(parseHash('#/co')).toEqual(stateRoute('CO'));
    expect(parseHash('#/CO/d/3')).toEqual(stateRoute('CO', { district: 3 }));
    expect(parseHash('#/TX/cut/0')).toEqual(stateRoute('TX', { cut: 0 }));
    expect(parseHash('#/CO/d/3/cut/4?plan=before&compare=enacted')).toEqual(
      stateRoute('CO', { district: 3, cut: 4, plan: 'before', enacted: true }),
    );
  });

  it('ignores invalid numbers', () => {
    expect(parseHash('#/CO/d/0')).toEqual(stateRoute('CO'));
    expect(parseHash('#/CO/d/abc')).toEqual(stateRoute('CO'));
    expect(parseHash('#/CO/cut/-1')).toEqual(stateRoute('CO'));
  });

  it('round-trips every shape', () => {
    const routes = [
      NATIONAL,
      stateRoute('RI'),
      stateRoute('CO', { district: 3 }),
      stateRoute('TX', { cut: 12, enacted: true }),
      stateRoute('MD', { district: 8, plan: 'before' }),
    ];
    for (const r of routes) expect(parseHash(formatHash(r))).toEqual(r);
    expect(formatHash(stateRoute('CO', { district: 3, enacted: true }))).toBe('#/CO/d/3?compare=enacted');
  });
});
