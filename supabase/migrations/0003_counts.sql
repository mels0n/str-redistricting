-- Ask counts per district, read by /api/counts. Like district_counts, only the service role can read it.

create or replace view ask_counts with (security_invoker = true) as
  select district_key, count(*)::int as asks
  from asks
  group by district_key;
revoke all on table ask_counts from anon, authenticated;
grant all on table ask_counts to service_role;
