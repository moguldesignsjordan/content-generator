-- Migration 021: prompt_logs — full-fidelity capture of every AI request the
-- app sends (Anthropic chat/generation calls, Gemini image renders), so an
-- admin can read exactly what context and prompts were assembled and tune
-- them (/prompts page).
--
-- Separate table from app_logs on purpose: a captured request is tens of KB
-- to a few MB of jsonb, and app_logs is a hot polled feed whose rows must
-- stay tiny. The list view reads only the summary columns (model, preview,
-- counts); the full `request` payload is fetched one row at a time on the
-- detail page.
--
-- No FK to drafts/brands: capture happens at the HTTP client layer, below
-- where those ids are known. Correlate by timestamp against app_logs usage
-- rows when needed.
--
-- Additive and idempotent, matching migrations 001-020.

create table if not exists prompt_logs (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  provider       text not null check (provider in ('anthropic', 'gemini')),
  endpoint       text not null,            -- e.g. "/v1/messages"
  model          text,
  preview        text not null default '', -- first line of the system prompt (or first user msg)
  message_count  integer not null default 0,
  char_count     integer not null default 0, -- serialized request size after sanitizing
  request        jsonb not null              -- full request body, base64 payloads stripped
);

create index if not exists idx_prompt_logs_created on prompt_logs(created_at desc);
