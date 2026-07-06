-- Migration 008: real keyword research data on topics (Slice 4, "enrich" cut).
-- A topic's target_keyword/intent have always been guesses (AI-authored or
-- hand-typed) with no idea whether anyone searches it. This column holds the
-- DataForSEO-validated numbers once a human taps "Research" on a topic:
-- primary keyword volume/difficulty/intent/cpc plus a few secondary keyword
-- suggestions. jsonb, defaults to '{}' so every existing topic reads as
-- "not yet researched" (researched = !!keyword_data.primary).
--
-- Additive and idempotent, matching migrations 001-007.

alter table topics
  add column if not exists keyword_data jsonb not null default '{}'::jsonb;
