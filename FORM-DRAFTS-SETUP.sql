-- Run this once inside the Supabase SQL editor (Project > SQL Editor > New
-- query) to enable the admin panel's "טיוטות פניות" tab - live capture of
-- what visitors type into the contact form / checkout mini-contact form,
-- even if they never press "שליחה" (see api/form-drafts.js and the
-- draft-saving snippet near the bottom of index.html).
--
-- Same pattern as order_attempts (ניסיונות תשלום): the row is created/
-- updated as the visitor types (debounced, client-side), and removed the
-- moment they actually submit the real form - so this table only ever
-- holds *unfinished* attempts, which is the point.

create table if not exists form_drafts (
  id uuid primary key default gen_random_uuid(),
  draft_id text not null unique,
  type text not null default 'contact',
  name text,
  phone text,
  email text,
  message text,
  ip text,
  time_on_site_seconds integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table form_drafts enable row level security;

-- No public (anon) policies on purpose - reads/writes go through
-- /api/form-drafts on the server using the service-role key, same as
-- every other table here.

create index if not exists form_drafts_updated_at_idx on form_drafts (updated_at desc);
