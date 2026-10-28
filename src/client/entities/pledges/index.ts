// The pledges entity: who has publicly pledged to support the rule, as published in pledges.json. Public API of the slice.
export { loadPledges } from './api';
export { PledgeSchema, PledgesFileSchema, inPledgeOrder } from './model';
export type { Pledge, PledgesFile } from './model';
