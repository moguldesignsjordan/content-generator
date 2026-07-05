-- Migration 004: multi-platform publishing.
-- 1. publications.target becomes plain text so a new provider (Klaviyo,
--    Beehiiv, ...) is an adapter file + registry line, never a schema change.
--    unique(job_id, target) stays: per-destination idempotency, and the same
--    draft may go to several platforms (one row per target).
-- 2. brand_integrations: per-brand provider connections. v1 reads credentials
--    from env; config jsonb is shaped to hold an ENCRYPTED credential
--    reference later (multi-tenant work, deliberately not solved here).

alter table publications drop constraint if exists publications_target_check;

create table if not exists brand_integrations (
  id           uuid primary key default gen_random_uuid(),
  brand_id     uuid not null references brands(id) on delete cascade,
  provider_id  text not null,
  config       jsonb not null default '{}'::jsonb,
  connected_at timestamptz not null default now(),
  unique (brand_id, provider_id)
);
