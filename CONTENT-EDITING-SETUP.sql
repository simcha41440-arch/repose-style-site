-- הרצה חד-פעמית ב-Supabase (SQL Editor -> New query -> Run) כדי לאפשר
-- עריכת תוכן מעמוד הניהול: תמונות מוצרים, טקסטים ותמונות בעמוד הבית
-- ובעמוד "אודות".
--
-- בטוח להרצה גם אם כבר הרצתם את זה בעבר (IF NOT EXISTS בכל שורה).

-- 1) תמונה מותאמת-אישית למוצר (בנוסף למחיר ולמבצע שכבר קיימים)
alter table if exists product_overrides add column if not exists image text;

-- 2) טבלת תוכן כללית לטקסטים ותמונות בעמוד הבית ובעמוד אודות
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

-- 3) מקום אחסון (bucket) ציבורי להעלאת תמונות מעמוד הניהול
insert into storage.buckets (id, name, public)
values ('site-images', 'site-images', true)
on conflict (id) do nothing;
