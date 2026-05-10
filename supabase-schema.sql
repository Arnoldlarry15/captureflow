-- CaptureFlow — Supabase Schema
-- Run this in: supabase.com → your project → SQL Editor → New Query

-- 1. Create artifacts table
create table if not exists public.artifacts (
  id          uuid primary key default gen_random_uuid(),
  session_id  text not null,
  title       text not null,
  category    text not null,
  content     text not null,
  tags        text[] default '{}',
  type        text not null default 'capture', -- 'capture' | 'source' | 'report' | 'audio'
  created_at  timestamptz default now()
);

-- 2. Index for fast session lookups
create index if not exists artifacts_session_id_idx
  on public.artifacts (session_id, created_at desc);

-- 3. Enable Row Level Security
alter table public.artifacts enable row level security;

-- 4. RLS Policy — allow all operations using anon key
--    (session_id acts as the access token for this app)
create policy "Allow all operations by session"
  on public.artifacts
  for all
  using (true)
  with check (true);

-- 5. Enable Realtime for live sync
alter publication supabase_realtime add table public.artifacts;
