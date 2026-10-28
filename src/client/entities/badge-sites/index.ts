// The badge-sites entity: which websites are verified to show the Fair Maps badge, from /api/badge-sites. Public API of the slice.
export { loadBadgeSites, resetBadgeSites } from './api';
export { BadgeSiteSchema, BadgeSitesSchema, siteForRep } from './model';
export type { BadgeSite } from './model';
