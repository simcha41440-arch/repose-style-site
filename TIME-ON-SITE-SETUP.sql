-- Run this once inside the Supabase SQL editor (Project > SQL Editor > New
-- query). Adds a "how long was this visitor on the site before they
-- reached out" column to both inquiries and form_drafts, powering the
-- admin panel's "🔥 חם / ❄️ קר" badge on the "פניות" and "טיוטות פניות"
-- tabs (see time_on_site_seconds in api/inquiries.js and
-- api/form-drafts.js, and the RS_SITE_SESSION tracking near the bottom
-- of index.html).
--
-- Safe to run even if the columns already exist.

alter table inquiries add column if not exists time_on_site_seconds integer;
alter table form_drafts add column if not exists time_on_site_seconds integer;
