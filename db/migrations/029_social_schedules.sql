-- Migration 029: social schedules (Phase 2, weekly social batch). A 'social'
-- schedule writes the coming week's flyer posts (Mon/Wed/Fri) for one review;
-- approved ones are posted by the daily cron on their planned day.
-- Idempotent. Apply in the Supabase SQL editor.

-- schema.sql/010 define the check inline on content_schedules.channel;
-- Postgres auto-named it content_schedules_channel_check.
alter table content_schedules drop constraint if exists content_schedules_channel_check;
alter table content_schedules
  add constraint content_schedules_channel_check
  check (channel in ('email', 'blog', 'social'));
