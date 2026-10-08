declare module 'vt-pbf' {
  interface TileLike {
    readonly features: readonly unknown[];
  }
  export function fromGeojsonVt(layers: Record<string, TileLike>, options?: { version?: number; extent?: number }): Uint8Array;
  const vtPbf: { fromGeojsonVt: typeof fromGeojsonVt };
  export default vtPbf;
}
