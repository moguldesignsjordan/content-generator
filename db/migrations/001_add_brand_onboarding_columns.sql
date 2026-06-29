-- Additive migration: brings an existing brands table up to the current schema
-- WITHOUT dropping data. Adds the three columns the onboarding/settings/generate
-- code now reads & writes. Safe to run multiple times (IF NOT EXISTS).

alter table brands add column if not exists visual_identity  jsonb not null default '{}'::jsonb;  -- logo_url, colors, fonts, footer
alter table brands add column if not exists positioning      jsonb not null default '{}'::jsonb;  -- business_description, tagline, differentiators, competitors
alter table brands add column if not exists onboarding_state jsonb not null default '{}'::jsonb;  -- { messages: [...], completed }
