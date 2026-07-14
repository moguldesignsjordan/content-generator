-- Migration 015: reference email library.
-- Idempotent. Apply in the Supabase SQL editor BEFORE pulling code that
-- reads/writes reference_emails (the app degrades to an empty library until
-- then).
--
-- A reference email is a full email the user pasted or uploaded as "write
-- like this": the raw text is kept for prompt injection, and style_profile
-- holds the style traits Claude distilled once at upload time
-- (prompts/extract-style.ts) so generation never re-analyzes it.

create table if not exists reference_emails (
  id            uuid primary key default gen_random_uuid(),
  brand_id      uuid not null references brands(id) on delete cascade,
  name          text not null,
  content       text not null,   -- raw email text (HTML already stripped)
  style_profile jsonb,           -- ReferenceEmailStyleProfile, null if extraction failed
  created_at    timestamptz not null default now()
);

create index if not exists reference_emails_brand_idx
  on reference_emails(brand_id);
