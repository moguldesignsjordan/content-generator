  -- ─────────────────────────────────────────────────────────────────────────────
  -- Automated Content Engine, schema (v1)
  -- Tables from automated-content-engine-plan.md §7.
  -- Apply in the Supabase SQL editor (or `psql`) before running `npm run seed`.
  --
  -- Design notes:
  --   • Strategy is DATA, not hardcoded, one brand now, multi-brand later (Phase 5)
  --     drops in cleanly because everything hangs off brands.id.
  --   • JSONB for the flexible strategy/profile blobs; typed columns for the
  --     fields the pipeline filters/joins on (status, funnel_stage, …).
  --   • CHECK constraints stand in for enums so values are self-documenting and
  --     easy to extend without ALTER TYPE.
  --   • Re-runnable: drop child→parent, then recreate.
  -- ─────────────────────────────────────────────────────────────────────────────

  create extension if not exists "pgcrypto";  -- gen_random_uuid()

  -- Drop in dependency order so the file is idempotent during early development.
  drop table if exists performance     cascade;
  drop table if exists publications    cascade;
  drop table if exists approvals       cascade;
  drop table if exists drafts          cascade;
  drop table if exists content_jobs    cascade;
  drop table if exists topics          cascade;
  drop table if exists clusters        cascade;
  drop table if exists pillars         cascade;
  drop table if exists icps            cascade;
  drop table if exists strategies      cascade;
  drop table if exists brands          cascade;

  -- ── Brand + strategy (the "marketing brain") ────────────────────────────────

  create table brands (
    id                 uuid primary key default gen_random_uuid(),
    name               text not null unique,
    voice_profile      jsonb not null default '{}'::jsonb,  -- voice, tone, examples, banned terms, cta library
    visual_identity    jsonb not null default '{}'::jsonb,  -- logo_url, colors, fonts, footer → email template tokens
    positioning        jsonb not null default '{}'::jsonb,  -- business_description, tagline, differentiators, competitors → prompt context
    onboarding_state   jsonb not null default '{}'::jsonb,  -- { messages: [{role,content}], completed } for chat onboarding
    sanity_config      jsonb not null default '{}'::jsonb,  -- project_id, dataset, doc_type, author_ref
    mailerlite_config  jsonb not null default '{}'::jsonb,  -- sender_name, sender_email, group_ids
    seo_defaults       jsonb not null default '{}'::jsonb,  -- geography, language, keyword_difficulty_max
    created_at         timestamptz not null default now()
  );

  -- Logos are uploaded as files to a Supabase Storage bucket named `logos`
  -- (public). Create it once in the Supabase dashboard, it lives in the
  -- `storage` schema, intentionally outside this drop/recreate block so
  -- re-running the schema doesn't wipe stored objects. The public URL is
  -- saved on the brand at visual_identity.logo_url.

  -- One current strategy per brand.
  create table strategies (
    id                 uuid primary key default gen_random_uuid(),
    brand_id           uuid not null references brands(id) on delete cascade,
    funnel_definition  jsonb not null default '{}'::jsonb,  -- stage -> { cta_type }
    updated_at         timestamptz not null default now(),
    unique (brand_id)
  );

  create table icps (
    id           uuid primary key default gen_random_uuid(),
    strategy_id  uuid not null references strategies(id) on delete cascade,
    label        text not null,
    is_primary   boolean not null default false,
    -- profile: demographics, values, jobs_to_be_done, pains, triggers,
    --          objections, awareness_stage, vocabulary
    profile      jsonb not null default '{}'::jsonb
  );

  create table pillars (
    id                   uuid primary key default gen_random_uuid(),
    strategy_id          uuid not null references strategies(id) on delete cascade,
    name                 text not null,
    description          text,
    business_goal        text,
    primary_funnel_stage text not null
      check (primary_funnel_stage in ('awareness', 'consideration', 'decision', 'brand')),
    target_icp_id        uuid references icps(id) on delete set null
  );

  -- One hub per cluster; spokes are rows in `topics`.
  create table clusters (
    id          uuid primary key default gen_random_uuid(),
    pillar_id   uuid not null references pillars(id) on delete cascade,
    hub_title   text not null,
    hub_keyword text,
    hub_intent  text
  );

  -- The join between strategy and production. The pipeline reads a topic and
  -- writes status/published_url back.
  create table topics (
    id                    uuid primary key default gen_random_uuid(),
    cluster_id            uuid not null references clusters(id) on delete cascade,
    title                 text not null,
    target_keyword        text,
    intent                text,
    funnel_stage          text
      check (funnel_stage in ('awareness', 'consideration', 'decision', 'brand')),
    internal_link_targets jsonb not null default '[]'::jsonb,
    maps_to_product       text,
    distribution_recipe   jsonb not null default '[]'::jsonb,
    status                text not null default 'idea'
      check (status in ('idea', 'queued', 'in_progress', 'published')),
    published_url         text,
    created_at            timestamptz not null default now()
  );

  -- ── Production pipeline (jobs → drafts → approvals → publications → metrics) ──

  create table content_jobs (
    id             uuid primary key default gen_random_uuid(),
    brand_id       uuid not null references brands(id) on delete cascade,
    topic_id       uuid references topics(id) on delete set null,
    type           text not null check (type in ('email', 'blog')),
    status         text not null default 'pending'
      check (status in ('pending', 'generating', 'in_review', 'published', 'failed')),
    trigger_source text not null default 'manual',
    created_at     timestamptz not null default now()
  );

  create table drafts (
    id         uuid primary key default gen_random_uuid(),
    job_id     uuid not null references content_jobs(id) on delete cascade,
    version    integer not null default 1,
    content    jsonb not null default '{}'::jsonb,  -- { subject, preheader, html } for email
    meta       jsonb not null default '{}'::jsonb,  -- meta_title, meta_description
    seo_data   jsonb not null default '{}'::jsonb,  -- qa findings, keyword usage, flags
    state      text not null default 'in_review'
      check (state in ('in_review', 'approved', 'rejected', 'superseded')),
    created_at timestamptz not null default now(),
    unique (job_id, version)
  );

  create table approvals (
    id         uuid primary key default gen_random_uuid(),
    draft_id   uuid not null references drafts(id) on delete cascade,
    reviewer   text,
    decision   text not null check (decision in ('approved', 'rejected', 'edited')),
    feedback   text,
    created_at timestamptz not null default now()
  );

  -- external_id makes publishing idempotent: on retry we find the existing row
  -- and never create a second MailerLite campaign / Sanity doc.
  create table publications (
    id           uuid primary key default gen_random_uuid(),
    job_id       uuid not null references content_jobs(id) on delete cascade,
    target       text not null check (target in ('mailerlite', 'sanity')),
    external_id  text,
    url          text,
    published_at timestamptz not null default now(),
    unique (job_id, target)
  );

  create table performance (
    id             uuid primary key default gen_random_uuid(),
    publication_id uuid not null references publications(id) on delete cascade,
    metric         text not null,   -- impressions, clicks, opens, …
    value          numeric,
    fetched_at     timestamptz not null default now()
  );

  -- ── Indexes the pipeline actually queries on ────────────────────────────────

  create index idx_topics_cluster   on topics(cluster_id);
  create index idx_topics_status    on topics(status);
  create index idx_clusters_pillar  on clusters(pillar_id);
  create index idx_pillars_strategy on pillars(strategy_id);
  create index idx_icps_strategy    on icps(strategy_id);
  create index idx_jobs_brand       on content_jobs(brand_id);
  create index idx_jobs_topic       on content_jobs(topic_id);
  create index idx_drafts_job       on drafts(job_id);
