-- Self-serve removal: a signer asks for a link, and the link (valid 48 hours from the moment its email is sent) deletes the row.
-- Only the hash of the token is stored. Notes cascade with the signer.

alter table signers add column if not exists remove_token_hash text null;
alter table signers add column if not exists remove_token_expires_at timestamptz null;
create unique index if not exists signers_remove_token_hash_idx on signers (remove_token_hash) where remove_token_hash is not null;

-- Same function as in 0002_outbox.sql with the 'remove' branch filled in: a sent removal email starts the 48 hours for its link.
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
  elsif r.kind = 'remove' then
    update signers set remove_token_expires_at = sent_at_ts + interval '48 hours' where id = r.signer_id;
  end if;
end;
$$;

revoke all on function mark_email_sent(bigint) from public, anon, authenticated;
