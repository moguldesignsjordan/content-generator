-- Migration 031: design looks. A look is a named group of example images
-- (ads or posts the owner wants flyers to look like), plus a design profile
-- Claude reads from them once at save time (prompts/extract-look.ts). Flyers
-- with a look are designed by the image model to follow the examples.
-- One look per brand can be the default for flyers made without a pick.
-- Idempotent. Not added to schema.sql's drop/recreate block: it holds real
-- saved-library state (same as media_assets/024, competitor_references/025).

create table if not exists design_looks (
  id          uuid primary key default gen_random_uuid(),
  brand_id    uuid not null references brands(id) on delete cascade,
  name        text not null,
  examples    jsonb not null default '[]'::jsonb,  -- [{ url, source, ref_id? }]
  profile     jsonb,                                -- DesignLookProfile, null if the read failed
  is_default  boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists design_looks_brand_idx on design_looks(brand_id);

-- At most one default look per brand.
create unique index if not exists design_looks_one_default_idx
  on design_looks(brand_id) where is_default;
