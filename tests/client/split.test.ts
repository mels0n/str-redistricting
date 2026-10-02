import { describe, expect, it } from 'vitest';
import { clampSize, splitterKey } from '../../src/client/shared/lib';

describe('clampSize', () => {
  it('keeps a size between its limits', () => {
    expect(clampSize(100, 280, 700)).toBe(280);
    expect(clampSize(900, 280, 700)).toBe(700);
    expect(clampSize(432.4, 280, 700)).toBe(432);
  });
  it('lets the minimum win when the room is smaller than it', () => {
    expect(clampSize(500, 240, 100)).toBe(240);
  });
});

describe('splitterKey', () => {
  const o = { grow: 'ArrowRight', shrink: 'ArrowLeft', shift: false };
  it('moves by a step, a bigger step with shift, and stays in the limits', () => {
    expect(splitterKey('ArrowRight', 400, 280, 700, o)).toBe(416);
    expect(splitterKey('ArrowLeft', 400, 280, 700, { ...o, shift: true })).toBe(336);
    expect(splitterKey('ArrowLeft', 285, 280, 700, o)).toBe(280);
    expect(splitterKey('ArrowRight', 695, 280, 700, o)).toBe(700);
  });
  it('jumps to the limits with Home and End', () => {
    expect(splitterKey('Home', 400, 280, 700, o)).toBe(280);
    expect(splitterKey('End', 400, 280, 700, o)).toBe(700);
  });
  it('ignores other keys', () => {
    expect(splitterKey('a', 400, 280, 700, o)).toBeNull();
  });
});
