import { describe, expect, it } from 'vitest';
import { checkPlanProvenance, checkPublishGate, staleStamps } from '../../../src/server/features/publish/index.js';
import { PlanMetricsSchema } from '../../../src/server/entities/plan-output/index.js';
import { LINE_SEARCH, stampOf, VERSIONS } from '../../../src/server/shared/config/index.js';
import { DataError } from '../../../src/server/shared/errors/index.js';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);
const stamp = stampOf(VERSIONS);
const bumped = (over: Partial<typeof stamp>) => ({ ...stamp, ...over });
const plan = (sha: string, beforeSha = sha, inputSha256 = A) => ({ sha, beforeSha, inputSha256 });
const same = { versions: stamp, ...plan(A) };

describe('checkPublishGate', () => {
  it('allows a first publish', () => {
    expect(() => checkPublishGate(null, same, false, 'RI')).not.toThrow();
  });
  it('lets --baseline stamp unstamped data', () => {
    expect(() => checkPublishGate(plan(A), { versions: stamp, ...plan(B) }, true, 'RI')).not.toThrow();
  });
  it('still gates a stamped state under --baseline', () => {
    expect(() => checkPublishGate({ versions: stamp, ...plan(A) }, { versions: stamp, ...plan(B) }, true, 'RI')).toThrow(DataError);
  });
  it('refuses unstamped published data without --baseline', () => {
    expect(() => checkPublishGate(plan(A), same, false, 'RI')).toThrow(new DataError('RI: published data has no version stamp; run publish-data --baseline once'));
  });
  it('allows, with a warning, a changed map under the same engine major while the version rules are not enforced', () => {
    const w = checkPublishGate({ versions: stamp, ...plan(A) }, { versions: stamp, ...plan(B) }, false, 'RI', false);
    expect(w).toMatch(/^RI: the map changed .*not enforced before the 1\.0 release/);
    expect(checkPublishGate({ versions: stamp, ...plan(A) }, { versions: stamp, ...plan(A) }, false, 'RI', false)).toBeUndefined();
  });
  it('refuses a changed map under the same engine major and census input', () => {
    expect(() => checkPublishGate({ versions: stamp, ...plan(A) }, { versions: stamp, ...plan(B) }, false, 'RI')).toThrow(
      'RI: the map changed but the engine major and the census input did not; bump the engine major (npm run release)',
    );
  });
  it('allows an identical map under the same versions', () => {
    expect(() => checkPublishGate({ versions: stamp, ...plan(A) }, same, false, 'RI')).not.toThrow();
  });
  it('allows a changed map when the engine major moved', () => {
    expect(() => checkPublishGate({ versions: stamp, ...plan(A) }, { versions: bumped({ engine: '2.0.0' }), ...plan(B) }, false, 'RI')).not.toThrow();
  });
  it('refuses a changed map when only the engine minor or patch moved', () => {
    expect(() => checkPublishGate({ versions: stamp, ...plan(A) }, { versions: bumped({ engine: '1.0.1' }), ...plan(B) }, false, 'RI')).toThrow('the map changed');
    expect(() => checkPublishGate({ versions: stamp, ...plan(A) }, { versions: bumped({ engine: '1.9.0' }), ...plan(B) }, false, 'RI')).toThrow('the map changed');
  });
  it('allows a changed map when the state census file changed', () => {
    expect(() => checkPublishGate({ versions: stamp, ...plan(A, A, A) }, { versions: stamp, ...plan(B, B, C) }, false, 'RI')).not.toThrow();
  });
  it('does not open for an input revision moved by the enacted districts alone', () => {
    const next = bumped({ input: { ...stamp.input, revision: stamp.input.revision + 1, sha256: C } });
    expect(() => checkPublishGate({ versions: stamp, ...plan(A) }, { versions: next, ...plan(B) }, false, 'RI')).toThrow('the map changed');
    // The same revision bump leaves an unchanged map alone.
    expect(() => checkPublishGate({ versions: stamp, ...plan(A) }, { versions: next, ...plan(A) }, false, 'RI')).not.toThrow();
  });
  it('allows a changed map under a new census vintage', () => {
    const next = bumped({ input: { ...stamp.input, vintage: 'census-2030', revision: 1 } });
    expect(() => checkPublishGate({ versions: stamp, ...plan(A) }, { versions: next, ...plan(B) }, false, 'RI')).not.toThrow();
  });
  it('refuses a change that only the before-balancing plan shows', () => {
    // Balancing absorbed the difference: the finished fingerprint is unchanged.
    expect(() => checkPublishGate({ versions: stamp, ...plan(A, A) }, { versions: stamp, ...plan(A, B) }, false, 'RI')).toThrow('the map changed');
    expect(() => checkPublishGate({ versions: stamp, ...plan(A, A) }, { versions: bumped({ engine: '2.0.0' }), ...plan(A, B) }, false, 'RI')).not.toThrow();
  });
  it('cannot compare the before-balancing plan when the published stats lack it', () => {
    const old = { versions: stamp, sha: A, inputSha256: A };
    expect(() => checkPublishGate(old, { versions: stamp, ...plan(A, B) }, false, 'RI')).not.toThrow();
  });
});

describe('checkPlanProvenance', () => {
  const expected = { engine: VERSIONS.engine, inputSha256: A, lineSearch: LINE_SEARCH };
  const metrics = (over: Record<string, unknown> = {}) =>
    PlanMetricsSchema.parse({
      state: 'RI', lineSearch: LINE_SEARCH, nodeVersion: 'v24', inputSha256: A, engine: VERSIONS.engine, seats: 2, population: 10, ideal: 5,
      districts: [], rangePersons: 1, rangePct: 0.1, allContiguous: true, assignmentSha256: B, ...over,
    });
  const major = Number(VERSIONS.engine.split('.')[0]);

  it('accepts a plan from this engine, the pinned census and the current line search', () => {
    expect(() => checkPlanProvenance(metrics(), 'RI', 'RI', expected)).not.toThrow();
  });
  it('accepts a different minor or patch of the same major', () => {
    expect(() => checkPlanProvenance(metrics({ engine: `${major}.9.9` }), 'RI', 'RI', expected)).not.toThrow();
  });
  it('refuses a plan with no engine, naming the state and the command to re-run', () => {
    const { engine: _e, ...rest } = metrics();
    expect(() => checkPlanProvenance(PlanMetricsSchema.parse(rest), 'RI', 'RI', expected)).toThrow(
      /^RI: the plan cannot be published, it records no engine version; re-run `npm run explore -- --states RI`$/,
    );
  });
  it('refuses a different engine major', () => {
    expect(() => checkPlanProvenance(metrics({ engine: `${major + 1}.0.0` }), 'RI', 'RI', expected)).toThrow(/different major.*explore -- --states RI/);
  });
  it('refuses a census hash other than the pinned one', () => {
    expect(() => checkPlanProvenance(metrics({ inputSha256: C }), 'RI', 'RI', expected)).toThrow(/census input sha256 is not the pinned one/);
  });
  it('refuses a plan drawn with another line search', () => {
    expect(() => checkPlanProvenance(metrics({ lineSearch: 'grid' }), 'RI', 'RI', expected)).toThrow(/line search is grid and the published search is exact/);
  });
  it('names the before-balancing plan and lists every mismatch', () => {
    expect(() => checkPlanProvenance(metrics({ inputSha256: C, lineSearch: 'grid' }), 'RI', 'RI before-balancing', expected)).toThrow(/^RI before-balancing: .*pinned one; its line search/);
  });
});

describe('staleStamps', () => {
  const current = stampOf(VERSIONS);
  it('is empty when every published state carries the current stamp', () => {
    expect(staleStamps([{ abbr: 'CO', versions: current }, { abbr: 'RI', versions: { ...current } }], current)).toEqual([]);
  });
  it('names states with an older or missing stamp', () => {
    const older = { ...current, maps: current.maps - 1 };
    expect(staleStamps([{ abbr: 'CO', versions: current }, { abbr: 'RI', versions: older }, { abbr: 'DE' }], current)).toEqual(['RI', 'DE']);
  });
});
