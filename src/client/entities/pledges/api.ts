import { dataUrl, fetchJson } from '../../shared';
import { PledgesFileSchema, type Pledge } from './model';

/** Every public pledge, validated; fetchJson shares one request between callers. */
export function loadPledges(): Promise<Pledge[]> {
  return fetchJson(dataUrl('pledges.json'), PledgesFileSchema).then((f) => f.pledges);
}
