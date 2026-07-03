-- Additive migration: campaign interview flow + real product data + brand
-- guidelines. Brings an existing database up to the current schema WITHOUT
-- dropping data. Safe to run multiple times (IF NOT EXISTS everywhere).
-- Apply in the Supabase SQL editor (this project talks to Supabase over REST
-- only, so raw DDL runs there).

-- Synthesized brand guidelines: voice/tone rules, messaging pillars, do/don't
-- language, audience summary, visual direction, cta philosophy + approved_at.
-- Proposed by Claude, edited and explicitly saved by a human.
alter table brands add column if not exists guidelines jsonb not null default '{}'::jsonb;

-- Real product/service data. topics.maps_to_product stores a slug; this table
-- gives the slug a name, description, deliverables, and price point so the
-- generation prompt can pitch an actual offer instead of a slug string.
create table if not exists products (
  id           uuid primary key default gen_random_uuid(),
  brand_id     uuid not null references brands(id) on delete cascade,
  slug         text not null,
  name         text not null,
  description  text,
  deliverables jsonb not null default '[]'::jsonb,  -- string[]
  price_point  text,
  url          text,
  created_at   timestamptz not null default now(),
  unique (brand_id, slug)
);

-- A campaign: one strategic interview (chat) that produces a brief, picks or
-- creates a topic, and drives generation. chat_state mirrors the pattern of
-- brands.onboarding_state ({ messages: [{role,content}] }) for resume.
create table if not exists campaigns (
  id          uuid primary key default gen_random_uuid(),
  brand_id    uuid not null references brands(id) on delete cascade,
  topic_id    uuid references topics(id) on delete set null,
  brief       jsonb not null default '{}'::jsonb,  -- goal, audience_notes, key_message, offer_slug, angle, constraints
  chat_state  jsonb not null default '{}'::jsonb,  -- { messages: [{role,content}] }
  status      text not null default 'briefing'
    check (status in ('briefing', 'generating', 'drafted', 'done')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Link a job (and therefore its drafts) back to the campaign that briefed it.
alter table content_jobs add column if not exists campaign_id uuid references campaigns(id) on delete set null;

create index if not exists idx_products_brand    on products(brand_id);
create index if not exists idx_campaigns_brand   on campaigns(brand_id);
create index if not exists idx_jobs_campaign     on content_jobs(campaign_id);
