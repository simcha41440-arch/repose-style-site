-- Run this once inside the Supabase SQL editor (Project > SQL Editor > New
-- query) to enable customer login/registration (see api/auth.js and the
-- "התחברות / הרשמה" tabs on the האזור האישי page).
--
-- After running this, also add an environment variable in Vercel
-- (Project Settings > Environment Variables, Production environment):
--   CUSTOMER_SESSION_SECRET = <any long random string, e.g. 40+ chars>
-- then redeploy. This is separate from ADMIN_SESSION_SECRET on purpose,
-- so a customer session cookie can never be used to access /admin.

create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null unique,
  phone text,
  password_hash text not null,
  -- "שכחתי סיסמה" flow (see api/auth.js action=forgot / action=reset):
  -- a fresh random token + expiry is written here when a reset email is
  -- requested, and cleared again the moment it's used (or a new one is
  -- requested). Storing the token itself (not just its hash) is fine
  -- here because this table is never reachable by the anon/browser role
  -- - only the server's service-role key can read it.
  reset_token text,
  reset_token_expires timestamptz,
  created_at timestamptz not null default now()
);

alter table customers enable row level security;

-- No public (anon) policies are defined on purpose: registration, login,
-- and reading a customer's own profile all go through /api/auth on the
-- server using the service-role key. That key bypasses RLS, so this
-- table only being reachable from server code is intentional and keeps
-- password hashes from ever being exposed to the browser.

create index if not exists customers_email_idx on customers (lower(email));

-- Safe to run even if you already ran an earlier version of this file
-- (before the "שכחתי סיסמה" columns existed) - adds them without
-- touching existing rows.
alter table customers add column if not exists reset_token text;
alter table customers add column if not exists reset_token_expires timestamptz;
