import { MapUnavailableError } from '../../shared';
import type { DistrictMapOptions, DistrictMapView } from './map';
import { isWebglFailure, webglAvailable } from './webgl';

export type { DistrictMapOptions, DistrictMapView, MapViewState } from './map';

/**
 * Mounts the state map. MapLibre is loaded here, on first use, so the
 * national index never downloads it. Throws MapUnavailableError when the
 * browser cannot draw it (no WebGL, or the map code did not load); the page then shows the indexed list without a map.
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
    // Only a real graphics failure means "no map"; any other error is shown as the generic error.
    if (isWebglFailure(cause)) throw new MapUnavailableError('webgl', { cause });
    throw cause;
  }
}
