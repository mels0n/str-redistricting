declare module 'shapefile' {
  interface ShapefileSource {
    read(): Promise<{ done: boolean; value: { properties: unknown; geometry: unknown } }>;
  }
  interface DbfSource {
    read(): Promise<{ done: boolean; value: unknown }>;
  }
  export function open(shp: Uint8Array, dbf?: Uint8Array, options?: { encoding?: string }): Promise<ShapefileSource>;
  export function openDbf(dbf: Uint8Array, options?: { encoding?: string }): Promise<DbfSource>;
}
