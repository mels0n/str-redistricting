import { dataUrl, VersionsSchema, type Versions } from '../config';
import { fetchJson } from './fetch-json';

/**
 * The versions behind the data that is actually published (public/data/versions.json), as opposed to the site's
 * bundled VERSIONS. Null when the file is missing or invalid: nothing is stamped yet, so nothing is claimed.
 */
export async function loadPublishedVersions(): Promise<Versions | null> {
  try {
    return await fetchJson(dataUrl('versions.json'), VersionsSchema);
  } catch {
    return null;
  }
}
