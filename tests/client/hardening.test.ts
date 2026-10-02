import { describe, expect, it } from 'vitest';
import {
  describeMultipleMatches,
  describeResolution,
  geocodeFailureFrom,
  normalizeAddress,
  parseGeocodeResponse,
  resolveAddress,
  type GeocodeResult,
} from '../../src/client/features/address-search';
import { JsonpError } from '../../src/client/shared/api/jsonp';
import {
  DataLoadError,
  DataShapeError,
  GeocodeError,
  MapUnavailableError,
  UnknownStateError,
  describeError,
} from '../../src/client/shared/lib/errors';
import { describeRouteIssue, fitRouteToState, parseHash, stateRoute, NATIONAL } from '../../src/client/shared/lib/route';
import type { StateIndex } from '../../src/client/entities/state';

const match = (matchedAddress: string, state = 'CO') => ({
  coordinates: { x: -104.98, y: 39.74 },
  addressComponents: { state, zip: '80203' },
  matchedAddress,
});

describe('several address matches', () => {
  it('uses the first and says how many there were', () => {
    const r = parseGeocodeResponse({
      result: { addressMatches: [match('200 E COLFAX AVE, DENVER, CO, 80203'), match('200 E COLFAX AVE, AURORA, CO, 80010')] },
    });
    expect(r.matchedAddress).toBe('200 E COLFAX AVE, DENVER, CO, 80203');
    expect(r.matchCount).toBe(2);
    expect(describeMultipleMatches(2)).toMatch(/2 possible matches/);
    expect(describeMultipleMatches(1)).toBe('');
  });
});

describe('typed addresses', () => {
  it('collapses whitespace without touching letters, and caps the length', () => {
    expect(normalizeAddress('  1  High St\n Columbus  ')).toBe('1 High St Columbus');
    expect(normalizeAddress('Mississippi Ave')).toBe('Mississippi Ave');
    expect(normalizeAddress('x'.repeat(500))).toHaveLength(200);
  });
});

describe('lookup failures', () => {
  it('maps every script failure to a typed lookup failure', () => {
    expect(geocodeFailureFrom(new JsonpError('timeout')).kind).toBe('timeout');
    expect(geocodeFailureFrom(new JsonpError('network')).kind).toBe('network');
    expect(geocodeFailureFrom(new JsonpError('no-callback')).kind).toBe('bad-response');
    expect(geocodeFailureFrom(new Error('anything else')).kind).toBe('network');
  });

  it('has a distinct plain sentence for each', () => {
    const kinds = ['empty', 'no-match', 'network', 'timeout', 'bad-response'] as const;
    const texts = kinds.map((kind) => describeError(new GeocodeError(kind)));
    expect(new Set(texts).size).toBe(kinds.length);
    for (const t of texts) expect(t).not.toMatch(/GeocodeError|undefined|—/);
  });
});

const summary = {
  population: 1,
  ideal: 1,
  rangePersons: 0,
  rangePct: 0,
  allContiguous: true,
  assignmentSha256: 'a'.repeat(64),
  inputSha256: 'b'.repeat(64),
  angleStepDeg: 1,
};
const index: StateIndex = {
  states: [
    { abbr: 'CO', name: 'Colorado', seats: 8, hasData: true, summary },
    { abbr: 'TX', name: 'Texas', seats: 38, hasData: true, summary },
    { abbr: 'OH', name: 'Ohio', seats: 15, hasData: false },
  ],
};
const found = (state: string): GeocodeResult => ({ lonLat: [0, 0], state, matchedAddress: '1 MAIN ST', matchCount: 1 });

describe('where an address belongs', () => {
  it('stays on the page for the state being viewed', () => {
    expect(resolveAddress(index, found('CO'), 'CO')).toEqual({ kind: 'here' });
  });

  it('opens another state that has a map, from a state page or the national page', () => {
    const away = resolveAddress(index, found('TX'), 'CO');
    expect(away.kind).toBe('open');
    expect(resolveAddress(index, found('CO'), null).kind).toBe('open');
    if (away.kind === 'here') throw new Error('unexpected');
    expect(describeResolution(away, found('TX'))).toMatch(/Opening Texas/);
  });

  it('says plainly when the state has no map', () => {
    const res = resolveAddress(index, found('OH'), 'CO');
    expect(res.kind).toBe('no-map');
    if (res.kind === 'here') throw new Error('unexpected');
    expect(describeResolution(res, found('OH'))).toBe('1 MAIN ST is in Ohio. The map for Ohio has not been generated.');
  });

  it('says plainly when the address is not in one of the 50 states', () => {
    const res = resolveAddress(index, found('DC'), 'CO');
    expect(res.kind).toBe('outside');
    if (res.kind === 'here') throw new Error('unexpected');
    expect(describeResolution(res, found('DC'))).toMatch(/not in one of the 50 states/);
  });
});

describe('data and map errors', () => {
  it('tells a dropped connection, a timeout, a missing file and a server fault apart', () => {
    const offline = describeError(new DataLoadError('x', null));
    const slow = describeError(new DataLoadError('x', null, { timedOut: true }));
    const missing = describeError(new DataLoadError('x', 404));
    const broken = describeError(new DataLoadError('x', 503));
    expect(new Set([offline, slow, missing, broken]).size).toBe(4);
    expect(slow).toMatch(/too long/);
    expect(missing).toMatch(/not found/);
    expect(broken).toMatch(/server/);
  });

  it('explains unreadable data, unknown states and a missing map without internal detail', () => {
    expect(describeError(new DataShapeError('x', 'seats: expected number'))).not.toMatch(/seats/);
    expect(describeError(new UnknownStateError('ZZ'))).toBe('There is no state with the code ZZ.');
    expect(describeError(new MapUnavailableError('webgl'))).toMatch(/every district is listed in the Districts table/);
    expect(describeError(new MapUnavailableError('load'))).toMatch(/try again/i);
    expect(describeError(new Error('boom'))).toMatch(/Reload the page/);
  });
});

describe('links that do not fit the state', () => {
  it('leaves a good link alone', () => {
    const route = stateRoute('CO', { district: 8, cut: 7 });
    const fit = fitRouteToState(route, 8);
    expect(fit.issues).toEqual([]);
    expect(fit.route).toBe(route);
  });

  it('drops a district past the last one and explains it', () => {
    const fit = fitRouteToState(stateRoute('CO', { district: 99 }), 8);
    expect(fit.route).toEqual(stateRoute('CO'));
    expect(fit.issues).toEqual([{ kind: 'district', district: 99, seats: 8 }]);
    expect(describeRouteIssue(fit.issues[0]!, 'Colorado')).toBe(
      'Colorado has 8 districts, so there is no District 99. Showing the whole state.',
    );
  });

  it('clamps a cut past the last one and keeps the rest of the link', () => {
    const fit = fitRouteToState(stateRoute('CO', { district: 2, cut: 40, enacted: true }), 8);
    expect(fit.route).toEqual(stateRoute('CO', { district: 2, cut: 7, enacted: true }));
    expect(describeRouteIssue(fit.issues[0]!, 'Colorado')).toMatch(/Colorado has 7 cuts, so there is no cut 40/);
  });

  it('reports both problems at once, and a one-seat state has no cuts', () => {
    expect(fitRouteToState(stateRoute('CO', { district: 9, cut: 9 }), 8).issues).toHaveLength(2);
    const one = fitRouteToState(stateRoute('WY', { district: 2, cut: 1 }), 1);
    expect(one.route).toEqual(stateRoute('WY', { cut: 0 }));
    expect(describeRouteIssue(one.issues[1]!, 'Wyoming')).toMatch(/single district/);
  });

  it('routes an unknown code to the state page, where it is reported, and junk to the index', () => {
    expect(parseHash('#/ZZ')).toEqual(stateRoute('ZZ'));
    expect(parseHash('#/zz/d/99')).toEqual(stateRoute('ZZ', { district: 99 }));
    expect(parseHash('#/colorado')).toEqual(NATIONAL);
    expect(parseHash('#/CO/d/1000')).toEqual(stateRoute('CO'));
  });
});
