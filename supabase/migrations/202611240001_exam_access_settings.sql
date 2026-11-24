-- LBIS CBT: one global examination-room access password.
-- Run this migration in the Supabase SQL Editor before deploying admin-exam-access.
create table if not exists public.exam_access_settings (
  id smallint primary key default 1 check (id = 1),
  password_hash text not null,
  password_salt text not null,
  hash_iterations integer not null default 310000 check (hash_iterations >= 200000),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);
alter table public.exam_access_settings enable row level security;
revoke all on public.exam_access_settings from anon, authenticated;
grant all on public.exam_access_settings to service_role;
