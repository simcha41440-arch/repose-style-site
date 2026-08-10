-- הרצה חד-פעמית ב-Supabase (SQL Editor -> New query -> Run) כדי לאפשר
-- קופונים "חד-פעמיים": אחרי שקוד קופון נוצל בהזמנה משולמת אחת, הוא לא
-- יופיע יותר בקופה של האתר ואף אחד לא יוכל להשתמש בו שוב.
--
-- בטוח להרצה גם אם כבר הרצתם את זה בעבר (IF NOT EXISTS בכל שורה).

alter table if exists coupons add column if not exists used_at timestamptz;
alter table if exists coupons add column if not exists used_order_id text;
