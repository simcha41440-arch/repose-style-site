-- Run this once inside the Supabase SQL editor (Project > SQL Editor > New
-- query) to enable the admin panel's "שיחות עם הבוט" tab - every
-- conversation visitors have with the AI chat assistant (see
-- api/_lib/chatbot.js and chatbot.js).
--
-- One row per chat (per browser tab visit, or until the visitor presses
-- "שיחה חדשה"), updated after every message.

create table if not exists chat_conversations (
  id uuid primary key default gen_random_uuid(),
  session_id text not null unique,
  messages jsonb not null default '[]'::jsonb,
  message_count integer not null default 0,
  first_question text,
  page text,
  ip text,
  had_error boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists chat_conversations_updated_idx on chat_conversations (updated_at desc);

alter table chat_conversations enable row level security;

-- No public (anon) policies on purpose - reads/writes go through the
-- server (/api/inquiries for saving, /api/admin?action=chats for the
-- admin panel) using the service-role key, same as every other table here.
