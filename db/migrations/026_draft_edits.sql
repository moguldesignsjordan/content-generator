-- Migration 026: capture the reviewer's own edits as a learning signal.
-- Idempotent. Apply in the Supabase SQL editor BEFORE pulling code that writes
-- draft_edits (the app degrades to capturing nothing until then: every write
-- is non-fatal, exactly like prompt_logs/021).
--
-- Until now the ONLY thing that fed back into generation was the thumbs
-- rating: one bit, plus an optional note. Meanwhile every inline text fix,
-- every "rewrite this paragraph" instruction, and every style-chat request
-- was thrown away after it patched the draft, even though those are the
-- richest possible statement of what the user actually wants. This table
-- keeps them.
--
--   kind='inline'    a click-to-edit region saved by hand. before/after hold
--                    the region's text; instruction is null (the edit IS the
--                    instruction). An AI rewrite the user ACCEPTS also lands
--                    here: the accept path is the same region save, so what is
--                    captured is the text they kept, not a proposal they may
--                    have discarded.
--   kind='style'     a design-chat instruction. instruction holds the request;
--                    before/after are null (the change is spread across the
--                    document, so a text diff would be meaningless).
--
-- Nothing reads this automatically. It feeds the human-approved "learn from my
-- edits" action in Settings, which proposes additions to brands.guidelines
-- (migration 002) the same way the onboarding synthesis does. Keeping the
-- distillation manual is deliberate: silently retraining a brand's voice from
-- a week of typo fixes would be worse than not learning at all.
--
-- Not added to schema.sql's drop/recreate block -- holds real accumulated
-- history (same as reference_emails/015, media_assets/024,
-- competitor_references/025).

create table if not exists draft_edits (
  id           uuid primary key default gen_random_uuid(),
  brand_id     uuid not null references brands(id) on delete cascade,
  draft_id     uuid not null references drafts(id) on delete cascade,
  kind         text not null check (kind in ('inline', 'style')),
  region       text,             -- the data-region touched, when the edit names one
  before_text  text,             -- region text before (null for kind='style')
  after_text   text,             -- region text after (null for kind='style')
  instruction  text,             -- what the user asked for (kind='style')
  created_at   timestamptz not null default now()
);

create index if not exists draft_edits_brand_idx
  on draft_edits(brand_id, created_at desc);
