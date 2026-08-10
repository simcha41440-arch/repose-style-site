-- הרצה חד-פעמית ב-Supabase (SQL Editor -> New query -> Run) כדי לאפשר
-- "מבצעים" בעמוד הניהול: מחיר "לפני" מחוק בקו + מחיר המבצע לצידו,
-- בדיוק כמו באתרי איקומרס מובילים.
--
-- בטוח להרצה גם אם כבר הרצתם את זה בעבר (IF NOT EXISTS).

alter table if exists product_overrides add column if not exists compare_at_price numeric;
