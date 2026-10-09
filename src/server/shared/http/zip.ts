import type AdmZip from 'adm-zip';
import { DataError } from '../errors/index.js';

/**
 * No file inside a Census archive may unpack to more than 1 GiB. The largest real one (the Texas block shapefile)
 * unpacks to 649 MB, so this leaves about 60% headroom while stopping a decompression bomb before it is inflated.
 */
export const MAX_ENTRY_BYTES = 1_073_741_824;

/** The contents of the archive entry whose name ends in `ext`, refusing to inflate one whose declared size is over the cap. */
export function readZipEntry(zip: AdmZip, ext: string, label: string, maxBytes: number = MAX_ENTRY_BYTES): Buffer {
  const entry = zip.getEntries().find((x) => x.entryName.toLowerCase().endsWith(ext));
  if (!entry) throw new DataError(`${label}: archive has no ${ext} file`);
  const size = entry.header.size;
  if (size > maxBytes) throw new DataError(`${label}: ${entry.entryName} is ${size} bytes unpacked, over the ${maxBytes} byte limit`);
  return entry.getData();
}
