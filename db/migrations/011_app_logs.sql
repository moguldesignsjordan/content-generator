-- Migration 011: app_logs — unified real-time feed for errors/warnings/info
-- and per-call Claude token usage.
--
-- One table, not two: the Logs page is a single chronological feed with an
-- All/Errors/Warnings/Usage filter, so one polling query beats merge-sorting
-- two cursors. `level` doubles as severity (info/warn/error) and as the
-- usage-row discriminator; usage-only columns are null on log rows and vice
-- versa, matching the jsonb-flex + typed-columns split used elsewhere
-- (drafts.meta, topics.keyword_data).
--
-- draft_id is on delete set null, not cascade: drafts can be hard-deleted,
-- and a log/usage row is audit history that should survive that, just
-- losing the reference (unlike genuine child rows like publications/
-- approvals, which cascade).
--
-- Additive and idempotent, matching migrations 001-010.

create table if not exists app_logs (
  id                           uuid primary key default gen_random_uuid(),
  created_at                   timestamptz not null default now(),
  level                        text not null check (level in ('info', 'warn', 'error', 'usage')),
  source                       text not null,   -- e.g. "api:/api/drafts/[id]/reject", "pipeline:generate:email-copy"
  message                      text not null,
  context                      jsonb not null default '{}'::jsonb,
  -- Populated only when level = 'usage':
  model                        text,
  input_tokens                 integer,
  output_tokens                integer,
  cache_creation_input_tokens  integer,
  cache_read_input_tokens      integer,
  estimated_usd                numeric,
  draft_id                     uuid references drafts(id) on delete set null
);

create index if not exists idx_app_logs_created      on app_logs(created_at desc);
create index if not exists idx_app_logs_level_created on app_logs(level, created_at desc);
