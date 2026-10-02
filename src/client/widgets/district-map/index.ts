import { MapUnavailableError } from '../../shared';
import type { DistrictMapOptions, DistrictMapView } from './map';

export type { DistrictMapOptions, DistrictMapView, MapViewState } from './map';

/** True when the browser can create a WebGL context, which MapLibre needs. */
function webglAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

/**
 * Mounts the state map. MapLibre is loaded here, on first use, so the
 * national index never downloads it. Throws MapUnavailableError when the
 * browser cannot draw it; the page then shows the indexed list without a map.
 */
export async function createDistrictMap(opts: DistrictMapOptions): Promise<DistrictMapView> {
  if (!webglAvailable()) throw new MapUnavailableError('webgl');
  let mod: typeof import('./map');
  try {
    mod = await import('./map');
  } catch (cause) {
    throw new MapUnavailableError('load', { cause });
  }
  try {
    return await mod.mountDistrictMap(opts);
  } catch (cause) {
    throw new MapUnavailableError('webgl', { cause });
  }
}
