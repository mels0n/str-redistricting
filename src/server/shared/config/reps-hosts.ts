/**
 * The hosts a representative-data download may come from: the congress-legislators project (current members of
 * Congress and their social accounts) and Open States (current state legislators). Same rule as the Census hosts:
 * https only, no port, and a redirect to any other host is refused.
 */
export const REPS_HOSTS: ReadonlySet<string> = new Set(['unitedstates.github.io', 'data.openstates.org']);
