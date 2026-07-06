-- Migration 007: durable brand memory.
-- Learned facts the create agent picks up mid-conversation (a preference, a
-- decision, a constraint the user stated) and can recall in every future
-- session, distinct from the durable voice_profile (which only changes via
-- the explicit propose/confirm flow). content is one plain-text fact; kind
-- is a loose free-text label (e.g. "preference", "constraint", "decision")
-- for future filtering, not an enum, so new kinds never need a migration.
--
-- Additive and idempotent, matching migrations 001-006.

create table if not exists brand_memory (
  id         uuid primary key default gen_random_uuid(),
  brand_id   uuid not null references brands(id) on delete cascade,
  content    text not null,
  kind       text,
  source     text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_brand_memory_brand on brand_memory(brand_id);
