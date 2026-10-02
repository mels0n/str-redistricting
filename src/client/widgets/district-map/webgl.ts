/** True when the browser can create a WebGL context, which MapLibre needs. */
export function webglAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

/**
 * Whether an error from mounting the map is a genuine WebGL or graphics-context
 * failure (as opposed to, say, bad data or a bug), judged by its message and
 * its causes.
 */
export function isWebglFailure(err: unknown): boolean {
  for (let e: unknown = err, depth = 0; e instanceof Error && depth < 4; e = e.cause, depth++) {
    if (/webgl|web gl|gl context|graphics context|rendering context/i.test(e.message)) return true;
  }
  return false;
}
