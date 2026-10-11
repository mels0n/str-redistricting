declare module 'shapefile' {
  interface DbfSource {
    read(): Promise<{ done: boolean; value: unknown }>;
  }
  export function openDbf(dbf: Uint8Array, options?: { encoding?: string }): Promise<DbfSource>;
}
