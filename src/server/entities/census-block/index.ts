export { blocksFileName, blocksUrl, ensureZip, loadStateBlocks, loadBlockPolygons } from './download.js';
export { parseBlockFeature, parseBlockPolygons } from './parse.js';
export type { BlockPolygons } from './parse.js';
export type { Assignment, Block } from './model.js';
export { boundarySegments, buildTopology, forEachEdge, isConnected, keepsConnectedWithout } from './topology.js';
export type { BoundarySegments, Topology } from './topology.js';
