-- Migration 005: content subtype (email_type, blog_type) on content_jobs.
-- The marketing purpose of an email / the format of a blog post, kept
-- separate from content_jobs.type ('email' | 'blog'). Nullable: derived at
-- generation time (resolveEmailType / resolveBlogType in prompts/) and
-- backfilled to the resolved value, OR set explicitly to override the
-- derivation per job. Drives per-type length budgets (EMAIL_LENGTH_TARGETS /
-- BLOG_LENGTH_TARGETS) and lets dashboards filter by subtype ("show
-- promotional emails").
--
-- Additive and idempotent. A row only ever populates the column matching its
-- type (email rows set email_type, blog rows set blog_type); the other stays
-- null. No backfill is needed for correctness: generation re-derives the type
-- from the topic when the column is null, so existing jobs keep behaving
-- exactly as before.
--
-- NOTE: apply this BEFORE pulling any code that reads these columns, or
-- generation will error on the SELECT. Safe to apply on its own.

alter table content_jobs
  add column if not exists email_type text
    check (email_type in ('newsletter', 'product', 'service', 'promotional', 'announcement'));

alter table content_jobs
  add column if not exists blog_type text
    check (blog_type in ('pillar', 'how_to', 'listicle', 'case_study', 'thought_leadership', 'landing'));
