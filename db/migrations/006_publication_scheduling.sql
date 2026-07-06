-- Migration 006: delivery status + scheduled time on publications.
-- Publishing an email now drives MailerLite's send/schedule directly (no
-- second manual step in the MailerLite dashboard), so the app needs to know
-- what actually happened: sent now, scheduled for later, or created but not
-- yet scheduled (the schedule call failed after the campaign was created,
-- kept as a non-throwing degrade path so a retry never double-creates the
-- campaign). Blog publications (Sanity) keep defaulting to 'sent'; they have
-- no scheduling concept.
--
-- Additive and idempotent. Existing rows default to 'sent' with no
-- scheduled_for, which matches their actual historical behavior (MailerLite
-- campaigns were created but never auto-scheduled before this migration).

alter table publications
  add column if not exists status text not null default 'sent'
    check (status in ('sent', 'scheduled', 'draft'));

alter table publications
  add column if not exists scheduled_for timestamptz;
