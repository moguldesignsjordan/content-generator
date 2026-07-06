-- Migration 010: content_schedules (improvement plan 6, "recurring
-- automation"). A schedule periodically auto-generates a draft for the
-- oldest un-started topic and leaves it in_review, same approval gate as a
-- manually triggered draft. next_run_at drives which rows the daily cron
-- picks up (see app/api/cron/run-schedules/route.ts); it only advances after
-- an attempt (success or "no topics" skip), so a missed cron tick or a
-- transient error just gets retried on the next tick instead of being lost.
--
-- Additive and idempotent, matching migrations 001-009.

create table if not exists content_schedules (
  id            uuid primary key default gen_random_uuid(),
  brand_id      uuid not null references brands(id) on delete cascade,
  channel       text not null check (channel in ('email', 'blog')),
  cadence       text not null check (cadence in ('daily', 'weekly', 'biweekly', 'monthly')),
  -- Optional override of the derived email_type/blog_type (mirrors
  -- content_jobs, migration 005). Left null, generation derives the type
  -- from the picked topic as usual.
  email_type    text check (email_type in ('newsletter', 'product', 'service', 'promotional', 'announcement')),
  blog_type     text check (blog_type in ('pillar', 'how_to', 'listicle', 'case_study', 'thought_leadership', 'landing')),
  active        boolean not null default true,
  next_run_at   timestamptz not null default now(),
  last_run_at   timestamptz,
  last_result   text,
  created_at    timestamptz not null default now()
);

create index if not exists idx_content_schedules_due
  on content_schedules(next_run_at) where active;

create index if not exists idx_content_schedules_brand
  on content_schedules(brand_id);
