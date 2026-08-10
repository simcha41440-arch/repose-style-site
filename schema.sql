-- Run this once inside the Supabase SQL editor (Project > SQL Editor > New query).
-- It creates the two tables the API routes in /api use, and locks
-- both down with Row Level Security so that only the service-role
-- key used by the server-side API can write to them.

create extension if not exists pgcrypto;

-- Product overrides: the storefront ships with a static catalog baked
-- into index.html. Any row here with active = true overrides that
-- product's name/price for every visitor.
create table if not exists product_overrides (
  id text primary key,
  name text,
  price numeric,
  -- Sale/"was" price shown crossed-out next to the current price on the
  -- storefront when it's set and higher than price (see the admin panel's
  -- "מבצע" fields and priceHTML() in index.html). Null = no sale.
  compare_at_price numeric,
  -- Admin-uploaded replacement image for this product (public URL in the
  -- "site-images" Storage bucket - see api/admin/upload-image.js). Null =
  -- keep the built-in product photo from index.html.
  image text,
  -- Marks a product "אזל מהמלאי" (out of stock) on the storefront: still
  -- shown in the catalog (grayed out, badge, purchase disabled) rather
  -- than hidden entirely - see the admin panel's "מוצרים" tab.
  out_of_stock boolean not null default false,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table product_overrides enable row level security;

-- The public (anon) role may only read active overrides.
create policy "Public can read active product overrides"
  on product_overrides
  for select
  using (active = true);

-- No insert/update/delete policy is defined for the anon role, so
-- only the service-role key (used exclusively by /api/products on
-- the server) can write to this table.

-- Orders placed from the storefront checkout.
create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  order_id text not null unique,
  customer jsonb not null,
  items jsonb not null,
  total numeric,
  notes text,
  status text not null default 'new',
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

alter table orders enable row level security;

-- No public policies are defined on purpose: reading the order list
-- and updating order status both require an authenticated admin, and
-- both go through /api/orders on the server using the service-role
-- key. Creating an order also goes through that same server route
-- (POST /api/orders), which inserts using the service-role key, so
-- RLS blocking direct anon inserts is intentional and safe.

-- Inquiries: "צור קשר" submissions, and the mini contact form inside
-- checkout. Saved directly to the database (like orders) so they always
-- show up in the admin panel's "פניות" tab, regardless of whether the
-- best-effort notification email succeeds.
create table if not exists inquiries (
  id uuid primary key default gen_random_uuid(),
  inquiry_id text not null unique,
  type text not null default 'contact',
  name text,
  phone text,
  email text,
  message text,
  status text not null default 'new',
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

alter table inquiries enable row level security;

-- Same reasoning as orders above: no public policies on purpose. Both
-- creating an inquiry (POST) and reading/updating them (GET/PUT) go
-- through /api/inquiries on the server using the service-role key.

-- Discount coupons managed from the admin panel's "קופונים" tab. The
-- storefront's checkout page fetches GET /api/coupons (public, active
-- coupons only - see api/coupons.js) to validate a code and compute a
-- discount, exactly like product_overrides above.
create table if not exists coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  percent numeric not null check (percent > 0 and percent <= 100),
  min_subtotal numeric,
  active boolean not null default true,
  -- Single-use tracking: once a coupon is redeemed by a real paid order,
  -- used_at is stamped and used_order_id records which order redeemed it.
  -- From that moment on /api/coupons stops returning it to the storefront
  -- (see api/coupons.js), so nobody else can apply the same code again.
  used_at timestamptz,
  used_order_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

alter table coupons enable row level security;

-- No public policies here either: GET is served through /api/coupons
-- using the service-role key (it manually filters to active=true before
-- responding), and POST/PUT/DELETE are admin-only via requireAdmin().

-- One row per real page load of the storefront, written by
-- POST /api/track-visit (see index.html, called only after the
-- cookie-consent bar is accepted). Powers the admin panel's
-- "ביקורים באתר" tab.
create table if not exists site_visits (
  id uuid primary key default gen_random_uuid(),
  path text,
  referrer text,
  ip text,
  user_agent text,
  created_at timestamptz not null default now()
);

alter table site_visits enable row level security;

-- One row per checkout attempt, from the moment the Tranzila iframe
-- opens (status "started") through to "success"/"failed", updated
-- either by the shopper's own browser or by Tranzila's server-to-server
-- notify callback (api/payment/tranzila-notify.js) - see api/order-attempts.js
-- for the full reasoning. Powers the admin panel's "ניסיונות תשלום" tab,
-- which is what makes abandoned/declined checkouts visible at all.
create table if not exists order_attempts (
  id uuid primary key default gen_random_uuid(),
  attempt_id text not null unique,
  customer jsonb,
  items jsonb,
  subtotal numeric,
  discount numeric,
  shipping numeric,
  total numeric,
  status text not null default 'started',
  tranzila_response jsonb,
  ip text,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

alter table order_attempts enable row level security;

-- No public policies on either table above: writes and status updates go
-- through /api/track-visit and /api/order-attempts respectively (public
-- POST/PUT, rate-limited, using the service-role key server-side), while
-- listing them in the admin panel is GET-only and admin-gated.

-- ============================================================
-- Security additions: login lockout, admin audit log, rate limiting
-- ============================================================

-- Records every admin login attempt (success or failure) by IP, so
-- /api/admin/login can lock an IP out for a cooldown period after too
-- many failures in a row. Written only by the server - no public
-- policies, same reasoning as the tables above.
create table if not exists login_attempts (
  id uuid primary key default gen_random_uuid(),
  ip text not null,
  username text,
  success boolean not null,
  created_at timestamptz not null default now()
);
alter table login_attempts enable row level security;
create index if not exists login_attempts_ip_created_idx on login_attempts (ip, created_at);

-- Audit trail of admin actions (logins, status changes, product edits) -
-- shown in the admin panel's new "יומן פעילות" tab so it's always
-- visible who changed what and when. Written only by the server after
-- requireAdmin() already confirmed the caller is an authenticated admin.
create table if not exists admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor text not null,
  action text not null,
  target text,
  details jsonb,
  ip text,
  created_at timestamptz not null default now()
);
alter table admin_audit_log enable row level security;
create index if not exists admin_audit_log_created_idx on admin_audit_log (created_at desc);

-- Lightweight per-IP rate limiting for the public, unauthenticated form
-- endpoints (orders, inquiries, newsletter signup) - counts recent
-- submissions per IP so a script can't flood the database or the
-- business inbox. Written and read only by the server.
create table if not exists rate_limit_events (
  id uuid primary key default gen_random_uuid(),
  bucket text not null,
  ip text not null,
  created_at timestamptz not null default now()
);
alter table rate_limit_events enable row level security;
create index if not exists rate_limit_events_bucket_ip_created_idx on rate_limit_events (bucket, ip, created_at);

-- Editable site text/images (admin panel's "עריכת תוכן" tab) - see
-- api/content.js. The public (anon) role may read every row so the
-- storefront can apply saved overrides on load; only the server's
-- service-role key can write.
create table if not exists site_content (
  key text primary key,
  value text,
  updated_at timestamptz not null default now()
);
alter table site_content enable row level security;
create policy "Public can read site content"
  on site_content
  for select
  using (true);

-- Public storage bucket for admin-uploaded images (product photos, hero
-- slides, About page photo). Uploads happen only through
-- api/admin/upload-image.js using the service-role key (which bypasses
-- Storage RLS entirely), so no additional storage policy is required for
-- writes; "public" here just means uploaded files are readable by anyone
-- via their public URL, same as the images already baked into the site.
insert into storage.buckets (id, name, public)
values ('site-images', 'site-images', true)
on conflict (id) do nothing;
