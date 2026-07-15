-- 020: thumbs up/down feedback on drafts.
-- A reviewer can rate any email draft; recent ratings are fed back into the
-- generation prompt as "write like this / never like this" examples, so the
-- generator learns the user's taste over time.
alter table drafts
  add column if not exists feedback text
    check (feedback in ('up', 'down'));

-- Generation reads "most recent rated emails for this brand"; the partial
-- index keeps that read cheap without indexing the (vast) unrated majority.
create index if not exists idx_drafts_feedback
  on drafts (created_at desc)
  where feedback is not null;
