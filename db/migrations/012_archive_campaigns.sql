-- Additive migration: lets campaigns be archived (hidden from the default
-- Campaigns list) instead of only supporting hard delete. Safe to run
-- multiple times (IF NOT EXISTS everywhere). Apply in the Supabase SQL
-- editor. Mirrors 003_archive_topics_drafts.sql.

-- Hard delete stays blocked once a campaign has sent/scheduled emails (see
-- app/api/campaigns/[id]/route.ts) so that publish history is never orphaned.
-- Archiving is just a display filter, so it's always safe regardless of
-- status.
alter table campaigns add column if not exists archived boolean not null default false;

create index if not exists idx_campaigns_archived on campaigns(archived);
