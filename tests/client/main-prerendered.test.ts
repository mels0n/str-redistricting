// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  document.body.replaceChildren();
  history.replaceState(null, '', '/');
});

describe('booting over a prerendered page', () => {
  it('keeps the prerendered content until the router replaces it, without duplicating it', async () => {
    let release!: (r: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { release = resolve; })));
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    document.body.innerHTML =
      '<div id="str-viewer" class="strv"><a href="#strv-main" class="strv-skip">Skip</a><div class="strv-outlet"><main id="strv-main"><h1>Prerendered heading</h1></main></div></div>';
    await import('../../src/client/app/main');
    const root = document.getElementById('str-viewer')!;
    // The release stamp has not arrived: the visitor still sees the prerendered page.
    expect(root.querySelector('.strv-outlet h1')?.textContent).toBe('Prerendered heading');
    expect(root.querySelectorAll('.strv-outlet')).toHaveLength(1);

    release(new Response('{}', { status: 404 }));
    await vi.waitFor(() => expect(root.querySelector('.strv-outlet h1')?.textContent).not.toBe('Prerendered heading'));
    expect(root.querySelectorAll('h1')).toHaveLength(1);
    expect(root.querySelectorAll('.strv-outlet')).toHaveLength(1);
    expect(document.activeElement).toBe(document.body);
  });
});
