-- Migration 014: social flyer jobs + reusable style reference library.
-- Idempotent. Apply in the Supabase SQL editor BEFORE pulling code that
-- inserts content_jobs rows with type='social'.

-- 1. Allow 'social' content jobs. schema.sql defines the check inline on
--    content_jobs.type; Postgres auto-named it content_jobs_type_check.
alter table content_jobs drop constraint if exists content_jobs_type_check;
alter table content_jobs
  add constraint content_jobs_type_check
  check (type in ('email', 'blog', 'social'));

-- 2. Reusable per-brand style references: uploaded once, picked at flyer
--    generation time, passed to the image model as a style-transfer reference.
create table if not exists style_references (
  id           uuid primary key default gen_random_uuid(),
  brand_id     uuid not null references brands(id) on delete cascade,
  name         text not null,
  image_url    text not null,   -- public Supabase Storage URL
  storage_path text not null,   -- bucket path, for clean deletion
  notes        text,
  created_at   timestamptz not null default now()
);

create index if not exists style_references_brand_idx
  on style_references(brand_id);
