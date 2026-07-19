-- Migration 025: competitor ad reference library ("swipe file").
-- Idempotent. Apply in the Supabase SQL editor BEFORE pulling code that
-- reads/writes competitor_references (the app degrades to an empty library
-- until then).
--
-- A competitor reference is a competitor's ad the user saved as "learn from
-- this strategy": pasted copy, a screenshot, or a scraped page. input_kind
-- tells the two shapes apart (the 016 migration's "one table, kind
-- discriminator" precedent):
--
--   input_kind='text'   content holds the raw ad copy (pasted or scraped).
--   input_kind='image'  image_url/storage_path hold the uploaded screenshot,
--                        same bucket shape as style_references (014).
--
-- Either shape stores competitor_profile: the marketing STRATEGY (hook,
-- angle, structure, persuasion levers, CTA style) Claude distills once at
-- save time (prompts/extract-competitor.ts), never the ad's actual words, so
-- generation injects the distilled strategy instead of re-analyzing the raw
-- ad on every draft. source_url records where the ad came from, when known.
--
-- Not added to schema.sql's drop/recreate block -- holds real saved-library
-- state (same as reference_emails/015 and media_assets/024).

create table if not exists competitor_references (
  id                  uuid primary key default gen_random_uuid(),
  brand_id            uuid not null references brands(id) on delete cascade,
  name                text not null,
  input_kind          text not null check (input_kind in ('text', 'image')),
  content             text,             -- raw ad copy (input_kind='text'), HTML already stripped
  image_url           text,             -- public Supabase Storage URL (input_kind='image')
  storage_path        text,             -- bucket path, for clean deletion (input_kind='image')
  source_url          text,             -- where the ad was seen, if the user gave one
  competitor_profile  jsonb,            -- CompetitorProfile, null if extraction failed
  created_at          timestamptz not null default now()
);

create index if not exists competitor_references_brand_idx
  on competitor_references(brand_id);
