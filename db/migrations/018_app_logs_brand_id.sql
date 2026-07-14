-- Migration 018: app_logs.brand_id — attribute every logged call to a brand.
--
-- app_logs (migration 011) is already the single chokepoint every Claude call
-- funnels through, which makes it the metering foundation for billing: to debit
-- the right customer we first have to know whose call it was. Nullable, because
-- every row written before this migration predates multi-tenancy (they all
-- belong to the one Mogul brand, but backfilling a guess into an audit table is
-- worse than leaving it honest and null) and because non-brand-scoped logs
-- (cron, startup errors) legitimately have no brand.
--
-- on delete set null, not cascade: matching draft_id in migration 011, a usage
-- row is audit history that should outlive the brand it referenced.
--
-- Additive and idempotent, matching migrations 001-017.

alter table app_logs
  add column if not exists brand_id uuid references brands(id) on delete set null;

-- The billing read path: "this brand's usage rows, newest first" (the /billing
-- usage breakdown and any per-brand spend check).
create index if not exists idx_app_logs_brand_created
  on app_logs(brand_id, created_at desc);
