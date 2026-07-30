-- Migration 028: inbound webhook deliveries (MailerLite today).
--
-- Performance was pull-only until now: someone had to open a draft and hit
-- Refresh for `lib/pipeline/performance.ts` to call MailerLite. Webhooks turn
-- that around — MailerLite tells us when a campaign is sent, opened, clicked.
--
-- This table is the idempotency ledger, not the data itself: the numbers still
-- land in `performance` (via a triggered stats refresh) so there is exactly one
-- source of truth for a campaign's totals. MailerLite ships NO per-delivery id
-- (verified against developers.mailerlite.com/docs/webhooks.html), so the
-- dedupe key is a sha256 of the raw request body. An exact retry of the same
-- payload collides on the unique index and short-circuits to 200; a genuinely
-- new event (different counts/timestamps) hashes differently and is processed.
--
-- brand_id is nullable on purpose: an event that arrives for a campaign we
-- can't map to a publication is still worth persisting for debugging rather
-- than dropped on the floor.

create table if not exists webhook_events (
  id           uuid primary key default gen_random_uuid(),
  provider     text not null,
  body_hash    text not null,
  event_type   text not null,
  brand_id     uuid references brands(id) on delete cascade,
  payload      jsonb not null,
  received_at  timestamptz not null default now(),
  processed_at timestamptz,
  error        text,
  unique (provider, body_hash)
);

create index if not exists webhook_events_brand_received_idx
  on webhook_events (brand_id, received_at desc);

-- Unprocessed/failed lookups for the logs surface.
create index if not exists webhook_events_unprocessed_idx
  on webhook_events (received_at desc)
  where processed_at is null;
