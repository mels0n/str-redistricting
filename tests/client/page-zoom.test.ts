// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pageZoomed, resetPageZoom, watchPageZoom } from '../../src/client/shared';

const BASE = 'width=device-width, initial-scale=1, viewport-fit=cover';

/** A stand-in for window.visualViewport whose scale the test sets. */
class FakeViewport extends EventTarget {
  scale = 1;
  zoom(scale: number): void {
    this.scale = scale;
    this.dispatchEvent(new Event('resize'));
  }
}

let vv: FakeViewport;

beforeEach(() => {
  vv = new FakeViewport();
  Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true });
  document.head.innerHTML = `<meta name="viewport" content="${BASE}">`;
});

afterEach(() => {
  vi.useRealTimers();
});

const meta = (): string => document.querySelector<HTMLMetaElement>('meta[name="viewport"]')!.content;

describe('page zoom', () => {
  it('counts only a real pinch-zoom as zoomed', () => {
    expect(pageZoomed()).toBe(false);
    vv.scale = 1.005;
    expect(pageZoomed()).toBe(false);
    vv.scale = 2;
    expect(pageZoomed()).toBe(true);
  });

  it('leaves the viewport alone when the page is not zoomed', () => {
    resetPageZoom();
    expect(meta()).toBe(BASE);
  });

  it('caps the scale briefly, then lifts the cap so the visitor can zoom again', () => {
    vi.useFakeTimers();
    vv.scale = 2.5;
    resetPageZoom();
    expect(meta()).toBe(`${BASE}, maximum-scale=1`);
    vi.runAllTimers();
    expect(meta()).toBe(BASE);
  });

  it('reports each change between zoomed and not, and stops when asked', () => {
    const seen: boolean[] = [];
    const stop = watchPageZoom((z) => seen.push(z));
    vv.zoom(2);
    vv.zoom(3);
    vv.zoom(1);
    stop();
    vv.zoom(2);
    expect(seen).toEqual([true, false]);
  });
});
