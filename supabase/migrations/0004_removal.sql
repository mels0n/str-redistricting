-- Self-serve removal: a signer asks for a link, and the link (valid 48 hours from the moment its email is sent) deletes the row.
-- Only the hash of the token is stored. Notes cascade with the signer.

alter table signers add column if not exists remove_token_hash text null;
alter table signers add column if not exists remove_token_expires_at timestamptz null;
-- When the current token was made. A token whose email never went out has no expiry, so it is refused once this is a week old,
-- and a new token is not made for the same signer within 30 minutes of this time.
alter table signers add column if not exists remove_token_set_at timestamptz null;
create unique index if not exists signers_remove_token_hash_idx on signers (remove_token_hash) where remove_token_hash is not null;

-- Same function (and signature) as in 0002_outbox.sql with the 'remove' branch filled in: a sent removal email starts the 48 hours for its link.
create or replace function mark_email_sent(p_id bigint, p_token_enc text) returns void
language plpgsql
as $$
declare
  r email_outbox%rowtype;
  sent_at_ts timestamptz := now();
begin
  update email_outbox set status = 'sent', sent_at = sent_at_ts, to_enc = null, token_enc = null
    where id = p_id and status = 'queued' and token_enc = p_token_enc returning * into r;
  if not found then
    return;
  end if;
  if r.kind = 'confirm' then
    update signers set token_expires_at = sent_at_ts + interval '48 hours' where id = r.signer_id and status = 'pending';
  elsif r.kind = 'remove' then
    update signers set remove_token_expires_at = sent_at_ts + interval '48 hours' where id = r.signer_id;
  end if;
end;
$$;

revoke all on function mark_email_sent(bigint, text) from public, anon, authenticated;
grant execute on function mark_email_sent(bigint, text) to service_role;

-- Removal emails go ahead of confirmations but may use at most `remove_cap` of each day's slots, so repeated requests
-- cannot starve confirmations. remove_sent counts the removal slots taken today.
alter table email_days add column if not exists remove_sent int not null default 0;

create or replace function claim_remove_slot(cap int, remove_cap int) returns boolean
language plpgsql
as $$
declare
  today date := (now() at time zone 'America/Chicago')::date;
  claimed boolean;
begin
  insert into email_days (day, sent) values (today, 0) on conflict (day) do nothing;
  update email_days set sent = sent + 1, remove_sent = remove_sent + 1
    where day = today and sent < cap and remove_sent < remove_cap returning true into claimed;
  return coalesce(claimed, false);
end;
$$;

create or replace function release_remove_slot() returns void
language sql
as $$
  update email_days set sent = sent - 1, remove_sent = remove_sent - 1
  where day = (now() at time zone 'America/Chicago')::date and sent > 0 and remove_sent > 0;
$$;

revoke all on function claim_remove_slot(int, int), release_remove_slot() from public, anon, authenticated;
grant execute on function claim_remove_slot(int, int), release_remove_slot() to service_role;
