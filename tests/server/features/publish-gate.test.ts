import { describe, expect, it } from 'vitest';
import { checkPublishGate, staleStamps } from '../../../src/server/features/publish/index.js';
import { stampOf, VERSIONS } from '../../../src/server/shared/config/index.js';
import { DataError } from '../../../src/server/shared/errors/index.js';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const stamp = stampOf(VERSIONS);
const bumped = (over: Partial<typeof stamp>) => ({ ...stamp, ...over });

describe('checkPublishGate', () => {
  it('allows a first publish', () => {
    expect(() => checkPublishGate(null, { versions: stamp, sha: A }, false, 'RI')).not.toThrow();
  });
  it('lets --baseline stamp unstamped data', () => {
    expect(() => checkPublishGate({ sha: A }, { versions: stamp, sha: B }, true, 'RI')).not.toThrow();
  });
  it('still gates a stamped state under --baseline', () => {
    expect(() => checkPublishGate({ versions: stamp, sha: A }, { versions: stamp, sha: B }, true, 'RI')).toThrow(DataError);
  });
  it('refuses unstamped published data without --baseline', () => {
    expect(() => checkPublishGate({ sha: A }, { versions: stamp, sha: A }, false, 'RI')).toThrow(
      new DataError('RI: published data has no version stamp; run publish-data --baseline once'),
    );
  });
  it('refuses a changed map under the same engine and input revision', () => {
    expect(() => checkPublishGate({ versions: stamp, sha: A }, { versions: stamp, sha: B }, false, 'RI')).toThrow(
      'RI: the map changed but the engine major and input revision did not; bump the engine major (npm run release)',
    );
  });
  it('allows an identical map under the same versions', () => {
    expect(() => checkPublishGate({ versions: stamp, sha: A }, { versions: stamp, sha: A }, false, 'RI')).not.toThrow();
  });
  it('allows a changed map when the engine version moved', () => {
    expect(() => checkPublishGate({ versions: stamp, sha: A }, { versions: bumped({ engine: '2.0.0' }), sha: B }, false, 'RI')).not.toThrow();
  });
  it('refuses a changed map when only the engine minor or patch moved', () => {
    expect(() => checkPublishGate({ versions: stamp, sha: A }, { versions: bumped({ engine: '1.0.1' }), sha: B }, false, 'RI')).toThrow('the map changed');
    expect(() => checkPublishGate({ versions: stamp, sha: A }, { versions: bumped({ engine: '1.9.0' }), sha: B }, false, 'RI')).toThrow('the map changed');
  });
  it('allows a changed map when the input revision moved', () => {
    const next = bumped({ input: { ...stamp.input, revision: stamp.input.revision + 1 } });
    expect(() => checkPublishGate({ versions: stamp, sha: A }, { versions: next, sha: B }, false, 'RI')).not.toThrow();
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
