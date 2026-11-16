-- Recorded from production, where it was applied on 25 September 2026 as version 20260925180228.
-- The worker publishes measured capture progress here; clients read it to render
-- a real preview frame and a truthful percentage.
alter table public.vistralo_jobs add column if not exists progress jsonb not null default '{}'::jsonb;
