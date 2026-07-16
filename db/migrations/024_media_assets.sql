-- Migration 024: media asset library.
-- Idempotent. Apply in the Supabase SQL editor before pulling code that reads
-- or writes media_assets (the media pipeline degrades to an empty library
-- until then, same as style_references pre-014).
--
-- Every image the app hosts (generated hero images, uploaded heroes, product
-- photos, flyer renders, direct library uploads) gets a row here so it can be
-- browsed and reused later without a fresh generation. This is separate from
-- style_references (migrations 014+016): a style reference steers HOW a new
-- image looks; a media asset IS a finished image someone might want to reuse
-- as-is. Not folded into schema.sql's drop/recreate block -- it holds real
-- uploaded/generated-object state.

create table if not exists media_assets (
  id              uuid primary key default gen_random_uuid(),
  brand_id        uuid not null references brands(id) on delete cascade,
  url             text not null,   -- public Supabase Storage URL
  storage_path    text not null,   -- bucket path, for clean deletion
  alt             text,
  kind            text not null default 'general'
                    check (kind in ('hero', 'flyer', 'product', 'general')),
  source          text not null default 'uploaded'
                    check (source in ('generated', 'uploaded')),
  style           text,   -- ContentImageStyle, set when source='generated'
  prompt          text,   -- final image prompt, set when source='generated'
  width           integer,
  height          integer,
  origin_draft_id uuid references drafts(id) on delete set null,
  created_at      timestamptz not null default now()
);

create index if not exists media_assets_brand_idx
  on media_assets(brand_id, created_at desc);
create index if not exists media_assets_brand_kind_idx
  on media_assets(brand_id, kind);
