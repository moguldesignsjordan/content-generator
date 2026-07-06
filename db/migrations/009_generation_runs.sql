-- Migration 009: cross-instance lock for in-flight draft generation runs
-- (improvement plan 4, "durable generation runs").
--
-- lib/pipeline/generation-runs.ts used to dedupe in-flight generations with a
-- module-level Map only, which works for one server instance but not a
-- multi-instance deployment: two instances could both start generation for
-- the same draft. This table is the shared lock. A heartbeat older than
-- STALE_LOCK_MS (see lib/db/queries.ts acquireGenerationLock) means the
-- owning instance died mid-run, so the lock can be stolen instead of
-- wedging the draft forever.
--
-- Additive and idempotent, matching migrations 001-008.

create table if not exists generation_runs (
  draft_id     uuid primary key references drafts(id) on delete cascade,
  status       text not null default 'running'
    check (status in ('running', 'done', 'error')),
  started_at   timestamptz not null default now(),
  heartbeat_at timestamptz not null default now()
);
