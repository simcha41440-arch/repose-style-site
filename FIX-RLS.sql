-- תיקון להתראת Supabase "rls_disabled_in_public"
-- מריצים את כל הקובץ הזה פעם אחת ב-SQL Editor (הוא בטוח להרצה גם אם
-- חלק מהטבלאות כבר מאובטחות - ALTER TABLE ... ENABLE RLS הוא idempotent).
--
-- הוא בסך הכל מוודא שה-RLS דלוק על כל טבלה ציבורית באפליקציה, בלי
-- לשנות שום פוליסה קיימת ובלי למחוק/ליצור נתונים.

alter table if exists product_overrides enable row level security;
alter table if exists orders             enable row level security;
alter table if exists inquiries          enable row level security;
alter table if exists coupons            enable row level security;
alter table if exists site_visits        enable row level security;
alter table if exists order_attempts     enable row level security;
alter table if exists login_attempts     enable row level security;
alter table if exists admin_audit_log    enable row level security;
alter table if exists rate_limit_events  enable row level security;

-- לוודא שיש פוליסת קריאה ציבורית לעדכוני מוצרים (לא לגעת אם כבר קיימת)
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'product_overrides'
      and policyname = 'Public can read active product overrides'
  ) then
    create policy "Public can read active product overrides"
      on product_overrides
      for select
      using (active = true);
  end if;
end $$;
