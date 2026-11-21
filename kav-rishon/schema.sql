-- קו ראשון: הרצה חד-פעמית ב-Supabase (SQL Editor > New query > Run)

create extension if not exists pgcrypto;

create table if not exists articles (
  id            uuid primary key default gen_random_uuid(),
  slug          text unique not null,
  title         text not null,
  subtitle      text,
  summary       text,            -- משפט אחד, למדור "בקיצור"
  impact        text,            -- "מה זה אומר עליך" (לא חובה)
  body          text not null,   -- פסקאות מופרדות בשורה ריקה
  category      text not null default 'general',
  city          text,            -- לחדשות מקומיות (לא חובה)
  is_breaking   boolean not null default false,
  status        text not null default 'pending'
                check (status in ('pending','published','rejected')),
  source_name   text,
  source_url    text,
  source_hash   text unique,     -- מונע כפילויות מאותו מקור
  image_url     text,            -- רק תמונה שעברה בדיקה ואושרה בלוח הבקרה
  ai_notes      text,            -- הערות ה-AI לעורך (ספקות, מה לבדוק)
  views         integer not null default 0,
  created_at    timestamptz not null default now(),
  published_at  timestamptz
);

create index if not exists articles_status_pub_idx on articles (status, published_at desc);
create index if not exists articles_category_idx on articles (category);

alter table articles enable row level security;
-- אין מדיניות ל-anon: כל הגישה עוברת דרך ה-API בצד השרת עם service-role key.

create or replace function increment_views(article_slug text)
returns void language sql security definer as $$
  update articles set views = views + 1 where slug = article_slug and status = 'published';
$$;
