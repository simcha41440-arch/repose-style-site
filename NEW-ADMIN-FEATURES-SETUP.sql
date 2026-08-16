-- ============================================================
-- NEW-ADMIN-FEATURES-SETUP.sql
-- Run this ONCE in Supabase (Project > SQL Editor > New query > paste > Run).
-- Safe to run even if some of this already exists - every statement below
-- uses "if not exists" / "add column if not exists", so re-running it by
-- accident won't break anything or duplicate data.
--
-- This adds:
--   1) admin_credentials  - lets you change the admin username/password
--      from inside the admin panel itself ("הגדרות התחברות" in the
--      "סקירה כללית" tab), instead of only through Vercel environment
--      variables. Until you actually change it from the panel, login
--      keeps working exactly as before with your existing
--      ADMIN_USERNAME / ADMIN_PASSWORD environment variables - this
--      table starts out empty and the server falls back to the
--      environment variables whenever it's empty.
--   2) two new columns on product_overrides, so the admin panel can add
--      brand new products to the מצעים / מגבות pages - not just change
--      the price/name of products that already exist.
-- ============================================================

-- ---------- 1) Admin login credentials (optional override) ----------
create table if not exists admin_credentials (
  id integer primary key default 1,
  username text not null,
  password_hash text not null,
  updated_at timestamptz not null default now(),
  constraint admin_credentials_single_row check (id = 1)
);

alter table admin_credentials enable row level security;
-- No public (anon) policies on purpose - this table is only ever read or
-- written by the server's service-role key inside api/admin.js, after
-- requireAdmin() has already confirmed the caller is a logged-in admin.

-- ---------- 2) New-product support on product_overrides ----------
-- category: "towel" for a new מגבות product, null/anything else = מצעים.
-- details: every extra field a brand-new product needs that the original
-- table didn't have room for (cotton %, thread count / fabric weight,
-- bed type, collection, tag, description, etc.) - kept as one flexible
-- JSON column instead of a dozen new ones, so future fields can be added
-- from the admin panel without another SQL migration.
alter table product_overrides add column if not exists category text;
alter table product_overrides add column if not exists details jsonb;
