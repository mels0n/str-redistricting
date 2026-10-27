-- "Why I signed" notes. The text is sealed (the 280-character limit is checked before sealing).
-- A note is shown only after status is set to 'approved' (and reviewed_at) in the table editor; sorting by flags puts flagged notes first.
-- RLS is on and there are no policies, so only the service role (the server) can read or write them. A note goes with its signer.

create table if not exists notes (
  id uuid primary key default gen_random_uuid(),
  signer_id uuid not null references signers (id) on delete cascade,
  body_enc text not null,
  show_public boolean not null,
  share_with_rep boolean not null,
  status text not null check (status in ('pending', 'approved', 'rejected')),
  flags text[] not null default '{}',
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);
alter table notes enable row level security;
create index if not exists notes_signer_id_idx on notes (signer_id);
create index if not exists notes_status_created_at_idx on notes (status, created_at desc);

revoke all on table notes from anon, authenticated;
