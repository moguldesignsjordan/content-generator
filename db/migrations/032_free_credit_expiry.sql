-- Migration 032: free credits expire, and free brands get no monthly top-up.
--
-- Free credits (starter grants, plus allowance_free grants from before this
-- migration) expire billing_config.free_credit_days after a brand's latest
-- free grant. Usage is counted against free credits first, so whatever is left
-- of them at expiry is max(0, free granted - all usage), capped at the balance.
-- Purchased and Pro credits never expire. The daily cron
-- (/api/cron/expire-free-credits) records the expiry as one debit per brand.
--
-- Also locks the balance RPCs to the service role. Supabase grants EXECUTE on
-- public functions to anon and authenticated by default, and these are
-- security definer, so anyone with the public anon key could call
-- grant_credits and mint credits.
--
-- Additive and idempotent, matching earlier migrations.

alter table credit_transactions drop constraint if exists credit_transactions_reason_check;
alter table credit_transactions add constraint credit_transactions_reason_check
  check (reason in (
    'starter', 'allowance_free', 'allowance_paid',
    'pack_purchase', 'usage', 'manual_adjustment', 'expiry'
  ));

alter table billing_config
  add column if not exists free_credit_days integer not null default 14;

-- No longer read by the app; zeroed so the row doesn't suggest otherwise.
update billing_config set free_monthly_allowance = 0 where id = 1;

-- Brands whose free credits are past expiry, not yet expired, and still have
-- some left. One row per brand; the cron debits each.
create or replace function free_credits_to_expire(p_days integer)
returns table (brand_id uuid, free_granted integer, used integer, balance integer)
language sql
stable
security definer
set search_path = public
as $$
  select f.bid, f.granted, coalesce(u.spent, 0)::integer, coalesce(cb.balance, 0)
  from (
    select t.brand_id as bid, sum(t.delta)::integer as granted, max(t.created_at) as last_grant
    from credit_transactions t
    where t.reason in ('starter', 'allowance_free')
    group by t.brand_id
  ) f
  left join (
    select t.brand_id as bid, sum(-t.delta)::integer as spent
    from credit_transactions t
    where t.reason = 'usage'
    group by t.brand_id
  ) u on u.bid = f.bid
  left join credits_balance cb on cb.brand_id = f.bid
  where f.last_grant < now() - make_interval(days => p_days)
    and f.granted > coalesce(u.spent, 0)
    and coalesce(cb.balance, 0) > 0
    and not exists (
      select 1 from credit_transactions e
      where e.brand_id = f.bid and e.reason = 'expiry'
    );
$$;

revoke execute on function grant_credits(uuid, integer, text, text, text) from public, anon, authenticated;
revoke execute on function debit_credits(uuid, integer, text, text, text, numeric) from public, anon, authenticated;
revoke execute on function free_credits_to_expire(integer) from public, anon, authenticated;
