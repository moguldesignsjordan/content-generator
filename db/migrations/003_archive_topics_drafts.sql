-- Additive migration: lets topics and drafts be archived (hidden from the
-- default view) instead of only supporting hard delete. Safe to run multiple
-- times (IF NOT EXISTS everywhere). Apply in the Supabase SQL editor.

-- Archiving a topic is always safe regardless of status: unlike hard delete
-- (still restricted to idea-stage topics, see app/api/topics/[id]/route.ts,
-- since content_jobs.topic_id is ON DELETE SET NULL and would orphan real
-- generation history), archiving is just a display filter, nothing cascades.
alter table topics add column if not exists archived boolean not null default false;

-- Same idea for drafts: tuck away a draft you don't want in the Emails list
-- without losing its content or approval history.
alter table drafts add column if not exists archived boolean not null default false;

create index if not exists idx_topics_archived on topics(archived);
create index if not exists idx_drafts_archived on drafts(archived);
