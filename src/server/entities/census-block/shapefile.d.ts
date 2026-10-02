declare module 'shapefile' {
  interface ShapefileSource {
    read(): Promise<{ done: boolean; value: { properties: unknown; geometry: unknown } }>;
  }
  export function open(shp: Uint8Array, dbf?: Uint8Array, options?: { encoding?: string }): Promise<ShapefileSource>;
}
