-- Sign-on: signers, rate limits, asks. RLS is on for every table and there are no policies,
-- so only the service role (the server) can read or write them.

create extension if not exists pgcrypto;

create table if not exists signers (
  id uuid primary key default gen_random_uuid(),
  email_hash text not null unique,
  email_enc text null,
  consent_updates boolean not null default false,
  state text not null,
  us_house text,
  state_house text,
  state_senate text,
  display_name_enc text null,
  town_enc text null,
  show_public boolean not null default false,
  status text not null check (status in ('pending', 'confirmed')),
  token_hash text null,
  token_expires_at timestamptz null,
  own_code text not null unique check (length(own_code) = 8),
  ref_code text null,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz null
);
alter table signers enable row level security;
create unique index if not exists signers_token_hash_idx on signers (token_hash) where token_hash is not null;
create index if not exists signers_status_token_expires_idx on signers (status, token_expires_at);

create table if not exists rate_limits (
  ip_hash text not null,
  at timestamptz not null default now()
);
create index if not exists rate_limits_ip_hash_at_idx on rate_limits (ip_hash, at);
create index if not exists rate_limits_at_idx on rate_limits (at);
alter table rate_limits enable row level security;

create table if not exists asks (
  id bigserial primary key,
  district_key text not null,
  office text not null,
  at timestamptz not null default now()
);
alter table asks enable row level security;

-- Explicit, in case default privileges ever grant the public API roles access.
revoke all on table signers, rate_limits, asks from anon, authenticated;
revoke all on sequence asks_id_seq from anon, authenticated;

create or replace view district_counts with (security_invoker = true) as
  select state, us_house, state_house, state_senate, count(*)::int as signers
  from signers
  where status = 'confirmed'
  group by state, us_house, state_house, state_senate;
revoke all on table district_counts from anon, authenticated;
