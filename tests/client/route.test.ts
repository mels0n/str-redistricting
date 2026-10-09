import { describe, expect, it } from 'vitest';
import { fitRouteToState, describeRouteIssue, formatHash, howRoute, CHANGELOG, parseHash, stateRoute, NATIONAL } from '../../src/client/shared/lib/route';

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

  it('opens the finished map for plan=finished and for the older plan=official', () => {
    expect(parseHash('#/CO?plan=finished')).toEqual(stateRoute('CO'));
    expect(parseHash('#/CO?plan=official')).toEqual(stateRoute('CO'));
    expect(parseHash('#/CO/d/2?plan=official&compare=enacted')).toEqual(stateRoute('CO', { district: 2, enacted: true }));
    expect(stateRoute('CO').plan).toBe('finished');
    // The finished map is the default, so a link never needs to name it.
    expect(formatHash(parseHash('#/CO?plan=official'))).toBe('#/CO');
  });

  it('parses and formats the balancing replay', () => {
    expect(parseHash('#/CO/balance/12')).toEqual(stateRoute('CO', { move: 12 }));
    expect(parseHash('#/CA/balance/473')).toEqual(stateRoute('CA', { move: 473 }));
    expect(parseHash('#/CO/balance/0')).toEqual(stateRoute('CO', { move: 0 }));
    expect(parseHash('#/CO/d/3/balance/4?compare=enacted')).toEqual(stateRoute('CO', { district: 3, move: 4, enacted: true }));
    expect(parseHash('#/CO/balance/-1')).toEqual(stateRoute('CO'));
    expect(parseHash('#/CO/balance/99999')).toEqual(stateRoute('CO'));
    // The cuts come first: a link naming both opens the cuts.
    expect(parseHash('#/CO/cut/3/balance/4')).toEqual(stateRoute('CO', { cut: 3 }));
    expect(formatHash(stateRoute('CO', { move: 7 }))).toBe('#/CO/balance/7');
    expect(formatHash(stateRoute('CO', { district: 2, move: 0 }))).toBe('#/CO/d/2/balance/0');
  });

  it('parses the How it works page and its sections', () => {
    expect(parseHash('#/how')).toEqual(howRoute());
    expect(parseHash('#/HOW')).toEqual(howRoute());
    expect(parseHash('#/how/balancing')).toEqual(howRoute('balancing'));
    expect(parseHash('#/how/nonsense')).toEqual(howRoute());
    expect(parseHash('#/changelog')).toEqual(CHANGELOG);
    expect(parseHash('#/Changelog/x')).toEqual(CHANGELOG);
    expect(formatHash(CHANGELOG)).toBe('#/changelog');
    expect(formatHash(howRoute())).toBe('#/how');
    expect(formatHash(howRoute('strays'))).toBe('#/how/strays');
    for (const r of [howRoute(), howRoute('inputs'), howRoute('sources'), howRoute('strange')]) expect(parseHash(formatHash(r))).toEqual(r);
  });

  it('corrects a balancing move past the last one', () => {
    const fit = fitRouteToState(stateRoute('CO', { move: 40 }), 8, 22);
    expect(fit.route.move).toBe(22);
    expect(describeRouteIssue(fit.issues[0]!, 'Colorado')).toMatch(/Colorado has 22 balancing moves, so there is no move 40/);
    expect(fitRouteToState(stateRoute('CO', { move: 22 }), 8, 22).issues).toHaveLength(0);
    // Before the number of moves is known, the move is left alone.
    expect(fitRouteToState(stateRoute('CO', { move: 40 }), 8).route.move).toBe(40);
    const none = fitRouteToState(stateRoute('WY', { move: 1 }), 1, 0);
    expect(none.route.move).toBeNull();
    expect(describeRouteIssue(none.issues[0]!, 'Wyoming')).toMatch(/no balancing to show/);
  });

  it('drops any cut or move request when there is nothing to cut or balance, even 0', () => {
    for (const cut of [0, 1, 5]) {
      const fit = fitRouteToState(stateRoute('WY', { cut }), 1, 0);
      expect(fit.route.cut).toBeNull();
      expect(describeRouteIssue(fit.issues[0]!, 'Wyoming')).toBe('Wyoming is a single district, so there are no cuts to show.');
    }
    for (const move of [0, 1]) {
      const fit = fitRouteToState(stateRoute('WY', { move }), 1, 0);
      expect(fit.route.move).toBeNull();
      expect(describeRouteIssue(fit.issues[0]!, 'Wyoming')).toMatch(/needed no balancing moves/);
    }
    // Cut 0 stays valid where there are cuts.
    expect(fitRouteToState(stateRoute('CO', { cut: 0 }), 8, 22).issues).toHaveLength(0);
  });
});
