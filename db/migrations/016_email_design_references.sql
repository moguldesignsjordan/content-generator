-- Migration 016: email design references.
-- Idempotent. Apply in the Supabase SQL editor BEFORE pulling code that reads
-- style_references.kind (the app falls back to the unfiltered flyer behavior
-- until then, so nothing breaks, but email design references stay invisible).
--
-- Reuses the migration-014 style_references table (same bucket, same shape)
-- instead of a parallel one: an uploaded reference image is an uploaded
-- reference image, whether a flyer copies its look or an email recreates its
-- layout. Three columns tell them apart:
--
--   kind           'flyer' (the 014 behavior, still the default) or 'email'
--   mode           'style'    = borrow the look loosely (flyer default)
--                  'recreate' = rebuild the actual layout with our own content
--   design_profile EmailDesignProfile distilled once at upload by
--                  prompts/extract-design.ts; null when analysis failed (the
--                  raw image alone is still enough to recreate from).

alter table style_references
  add column if not exists kind text not null default 'flyer';

alter table style_references
  add column if not exists mode text not null default 'style';

alter table style_references
  add column if not exists design_profile jsonb;

-- Named constraints added separately: an inline check on "add column if not
-- exists" is skipped on re-runs where the column already exists, so the guard
-- would silently never land. Same drop-then-add shape migration 014 uses.
alter table style_references
  drop constraint if exists style_references_kind_check;
alter table style_references
  add constraint style_references_kind_check
  check (kind in ('flyer', 'email'));

alter table style_references
  drop constraint if exists style_references_mode_check;
alter table style_references
  add constraint style_references_mode_check
  check (mode in ('style', 'recreate'));

create index if not exists style_references_brand_kind_idx
  on style_references(brand_id, kind);
