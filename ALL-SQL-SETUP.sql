-- ============================================================
-- כל ה-SQL שנדרש עד כה, במקום אחד. הרצה חד-פעמית ב-Supabase:
-- supabase.com/dashboard -> הפרויקט שלכם -> SQL Editor -> New query
-- -> להדביק את כל הקובץ הזה -> Run.
--
-- בטוח להרצה גם אם כבר הרצתם חלק מזה בעבר (הכל IF NOT EXISTS /
-- ON CONFLICT DO NOTHING) - שום דבר לא יימחק ולא יישבר.
-- ============================================================

-- קופונים חד-פעמיים
alter table if exists coupons add column if not exists used_at timestamptz;
alter table if exists coupons add column if not exists used_order_id text;

-- מבצעים ("מחיר לפני מבצע")
alter table if exists product_overrides add column if not exists compare_at_price numeric;

-- תמונת מוצר מותאמת אישית
alter table if exists product_overrides add column if not exists image text;

-- אזל מהמלאי
alter table if exists product_overrides add column if not exists out_of_stock boolean not null default false;

-- עריכת תוכן (טקסטים ותמונות בעמוד הבית ובעמוד אודות)
create table if not exists site_content (
  key text primary key,
  value text,
  updated_at timestamptz not null default now()
);
alter table site_content enable row level security;

drop policy if exists "Public can read site content" on site_content;
create policy "Public can read site content"
  on site_content
  for select
  using (true);

-- מקום אחסון (bucket) ציבורי להעלאת תמונות מעמוד הניהול
insert into storage.buckets (id, name, public)
values ('site-images', 'site-images', true)
on conflict (id) do nothing;
