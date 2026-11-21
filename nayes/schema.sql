-- נייעס: הרצה חד-פעמית ב-Supabase (SQL Editor > New query > Run)

create extension if not exists pgcrypto;

-- ---------- מבזקים ----------
create table if not exists articles (
  id            uuid primary key default gen_random_uuid(),
  slug          text unique not null,
  title         text not null,          -- שורת הכותרת המודגשת בבועה
  summary       text,                   -- טקסט המבזק עצמו (2-3 משפטים)
  body          text,                   -- "עוד פרטים" (לא חובה)
  impact        text,                   -- "מה זה אומר עליך" (לא חובה)
  category      text not null default 'general',
  city          text,
  is_breaking   boolean not null default false,
  score         integer,                -- ציון חשיבות 1-10 שנתן העורך האוטומטי
  status        text not null default 'pending'
                check (status in ('pending','published','rejected')),
  source_name   text,
  source_url    text,
  source_hash   text unique,            -- מונע כפילויות מאותו מקור
  image_url     text,                   -- רק תמונה שעברה בדיקה ואושרה
  ai_notes      text,
  views         integer not null default 0,
  reactions     jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  published_at  timestamptz
);

create index if not exists articles_status_pub_idx on articles (status, published_at desc);
alter table articles enable row level security;

-- ---------- פרסומות ----------
create table if not exists ads (
  id           uuid primary key default gen_random_uuid(),
  advertiser   text not null,          -- שם העסק
  title        text not null,          -- כותרת המודעה
  text         text,                   -- טקסט קצר
  cta          text,                   -- טקסט הכפתור, למשל "להזמנה"
  link         text,                   -- קישור / tel: / וואטסאפ
  image_url    text,                   -- עובר בדיקת AI לפני שמירה
  placement    text not null default 'feed'
               check (placement in ('top','feed','side')),
  color        text,                   -- צבע מותג (לא חובה), למשל #0a7d5a
  active       boolean not null default true,
  starts_at    timestamptz,
  ends_at      timestamptz,
  impressions  integer not null default 0,
  clicks       integer not null default 0,
  created_at   timestamptz not null default now()
);
alter table ads enable row level security;

-- אין מדיניות ל-anon: כל הגישה עוברת דרך ה-API בצד השרת עם service-role key.

-- ---------- פונקציות מונים ----------
create or replace function increment_views(article_slug text)
returns void language sql security definer as $$
  update articles set views = views + 1 where slug = article_slug and status = 'published';
$$;

create or replace function add_reaction(article_slug text, emoji text)
returns jsonb language sql security definer as $$
  update articles
     set reactions = jsonb_set(reactions, array[emoji],
                     to_jsonb(coalesce((reactions->>emoji)::int, 0) + 1))
   where slug = article_slug and status = 'published'
  returning reactions;
$$;

create or replace function ad_impressions(ad_ids uuid[])
returns void language sql security definer as $$
  update ads set impressions = impressions + 1 where id = any(ad_ids);
$$;

create or replace function ad_click(ad_id uuid)
returns text language sql security definer as $$
  update ads set clicks = clicks + 1 where id = ad_id returning link;
$$;

-- ---------- אחסון תמונות ----------
-- תיקייה פרטית: התמונות מוגשות לגולשים רק דרך האתר עצמו (/media/...).
insert into storage.buckets (id, name, public)
values ('media', 'media', false)
on conflict (id) do nothing;

-- ---------- פניות מטופס יצירת הקשר ----------
create table if not exists messages (
  id          uuid primary key default gen_random_uuid(),
  topic       text not null default 'general',   -- general / ads / correction
  name        text not null,
  phone       text,
  email       text,
  body        text not null,
  done        boolean not null default false,
  created_at  timestamptz not null default now()
);
alter table messages enable row level security;
