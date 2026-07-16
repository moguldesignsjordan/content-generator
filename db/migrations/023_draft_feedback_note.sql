-- 023: an optional reason alongside a thumbs-down rating.
-- A bare "down" only teaches the generator NOT to repeat something; a reason
-- (too stiff, too long, too generic, wrong vibe, or free text) teaches it
-- WHAT to fix, which is what "diagnose what went wrong" in the feedback
-- block actually needs to work with.
alter table drafts
  add column if not exists feedback_note text;
