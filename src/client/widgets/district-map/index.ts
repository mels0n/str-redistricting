import type { DistrictMapOptions, DistrictMapView } from './map';

export type { DistrictMapOptions, DistrictMapView, MapViewState } from './map';

/**
 * Mounts the state map. MapLibre is loaded here, on first use, so the
 * national index never downloads it.
 */
export async function createDistrictMap(opts: DistrictMapOptions): Promise<DistrictMapView> {
  const mod = await import('./map');
  return mod.mountDistrictMap(opts);
}
