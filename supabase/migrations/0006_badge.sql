-- Sites seen showing the Fair Maps badge. A row is made when the badge image is requested with a Referer from another site (only the
-- address of the page, no query or fragment; never an IP address or anything about the visitor). A daily check fetches the page and
-- sets verified_at (and found_url, the page where the badge was found) when the badge and a link back are really there. A row is listed only while verified_at is set and fewer than
-- two checks in a row have failed.
-- RLS is on and there are no policies, so only the service role (the server) can read or write them.

create table if not exists badge_sightings (
  url text primary key check (char_length(url) <= 300),
  host text not null,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  verified_at timestamptz,
  last_checked timestamptz,
  consecutive_failures integer not null default 0,
  found_url text check (found_url is null or char_length(found_url) <= 300),
  title text check (title is null or char_length(title) <= 80)
);
alter table badge_sightings enable row level security;
create index if not exists badge_sightings_last_checked_idx on badge_sightings (last_checked nulls first);
create index if not exists badge_sightings_first_seen_idx on badge_sightings (first_seen desc);

revoke all on table badge_sightings from anon, authenticated;
grant all on table badge_sightings to service_role;
