import { describe, expect, it } from 'vitest';
import { isWebglFailure } from '../../src/client/widgets/district-map/webgl';

describe('isWebglFailure', () => {
  it('recognises WebGL and graphics-context failures', () => {
    expect(isWebglFailure(new Error('Failed to initialize WebGL'))).toBe(true);
    expect(isWebglFailure(new Error('Could not create a WebGL context'))).toBe(true);
    expect(isWebglFailure(new Error('Failed to create a graphics context'))).toBe(true);
  });
  it('looks through the cause chain', () => {
    expect(isWebglFailure(new Error('map failed', { cause: new Error('WebGL is not supported') }))).toBe(true);
  });
  it('does not treat other errors as WebGL failures', () => {
    expect(isWebglFailure(new Error('Cannot read properties of undefined'))).toBe(false);
    expect(isWebglFailure(new TypeError('bad coordinates'))).toBe(false);
    expect(isWebglFailure('WebGL')).toBe(false);
    expect(isWebglFailure(undefined)).toBe(false);
  });
});
