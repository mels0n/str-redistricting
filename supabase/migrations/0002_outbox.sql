-- Email outbox with a daily cap. RLS is on and there are no policies, so only the service role (the server) can use these.
-- The quota day is the America/Chicago date, so it resets at midnight Central.

create table if not exists email_outbox (
  id bigserial primary key,
  kind text not null check (kind in ('remove', 'confirm')),
  signer_id uuid references signers (id) on delete cascade,
  to_enc text null,
  token_enc text null,
  status text not null check (status in ('queued', 'sent', 'failed')),
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  sent_at timestamptz null,
  -- A queued row holds the sealed address and token; a sent or failed row holds neither.
  constraint email_outbox_queued_has_payload check (status <> 'queued' or (to_enc is not null and token_enc is not null))
);
alter table email_outbox enable row level security;
create index if not exists email_outbox_queue_idx on email_outbox (status, kind, id);
-- One waiting email per signer and kind: signing again replaces the sealed token in place and keeps the place in line.
create unique index if not exists email_outbox_one_queued_idx on email_outbox (signer_id, kind) where status = 'queued';

create table if not exists email_days (
  day date primary key,
  sent int not null default 0
);
alter table email_days enable row level security;

revoke all on table email_outbox, email_days from anon, authenticated;
revoke all on sequence email_outbox_id_seq from anon, authenticated;

-- Takes one of today's slots. The conditional update is the only thing that decides whether an email may go out,
-- so concurrent callers can never take more than `cap`.
create or replace function claim_email_slot(cap int) returns boolean
language plpgsql
as $$
declare
  today date := (now() at time zone 'America/Chicago')::date;
  claimed boolean;
begin
  insert into email_days (day, sent) values (today, 0) on conflict (day) do nothing;
  update email_days set sent = sent + 1 where day = today and sent < cap returning true into claimed;
  return coalesce(claimed, false);
end;
$$;

-- True when no email may go out right now: today's quota is spent. Read-only.
create or replace function email_quota_spent(cap int) returns boolean
language sql stable
as $$
  select coalesce((select sent >= cap from email_days where day = (now() at time zone 'America/Chicago')::date), false);
$$;

-- Gives back a slot after a failed send.
create or replace function release_email_slot() returns void
language sql
as $$
  update email_days set sent = sent - 1
  where day = (now() at time zone 'America/Chicago')::date and sent > 0;
$$;

-- Records a successful send in one step: the row is marked sent, the sealed address and token are dropped,
-- and the 48 hours for the link start now.
create or replace function mark_email_sent(p_id bigint) returns void
language plpgsql
as $$
declare
  r email_outbox%rowtype;
  sent_at_ts timestamptz := now();
begin
  update email_outbox set status = 'sent', sent_at = sent_at_ts, to_enc = null, token_enc = null
    where id = p_id and status = 'queued' returning * into r;
  if not found then
    return;
  end if;
  if r.kind = 'confirm' then
    update signers set token_expires_at = sent_at_ts + interval '48 hours' where id = r.signer_id and status = 'pending';
  end if;
  -- kind 'remove': the removal migration replaces this function to also set signers.remove_token_expires_at.
end;
$$;

revoke all on function claim_email_slot(int), email_quota_spent(int), release_email_slot(), mark_email_sent(bigint) from public, anon, authenticated;
