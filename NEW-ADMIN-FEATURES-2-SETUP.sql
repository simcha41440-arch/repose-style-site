-- ============================================================
-- NEW-ADMIN-FEATURES-2-SETUP.sql
-- Run this ONCE in Supabase (Project > SQL Editor > New query > paste > Run),
-- in addition to NEW-ADMIN-FEATURES-SETUP.sql from before. Safe to re-run.
--
-- Adds two admin-only columns to orders, used by the new "תגית פנימית"
-- (quick VIP/urgent/needs-review tag) and "הערה פנימית" (a note only
-- admins see - separate from the customer-visible order notes) fields in
-- the "פרטים מלאים" view of the orders tab.
-- ============================================================

alter table orders add column if not exists internal_note text;
alter table orders add column if not exists admin_tag text;
