-- Migration 019: the credit ledger — balances, billing state, tunable config.
--
-- Credits are an integer, cents-equivalent denomination of the real per-call USD
-- cost that lib/pipeline/cost.ts priceUsage already computes. A markup
-- multiplier turns real cost into charged credits (the margin). Everything about
-- the economics is a row in billing_config, not a constant in code, so pricing
-- can be tuned without a redeploy.
--
-- Two tables, one job each:
--   credit_transactions  append-only audit. The truth. Never updated, never
--                        deleted; balance is derivable from sum(delta).
--   credits_balance      cached read path. One row per brand so the hot path
--                        ("can this brand afford a generation?") is a primary
--                        key lookup, not a sum() over history.
--
-- The two are kept in step by the RPCs below, which are the ONLY thing allowed
-- to move a balance. A weekly reconciliation asserts balance = sum(delta).
--
-- Additive and idempotent, matching migrations 001-018. Do NOT add these to
-- db/schema.sql's drop-and-recreate block: they hold real money state.

-- ── Ledger ───────────────────────────────────────────────────────────────────

create table if not exists credit_transactions (
  id              uuid primary key default gen_random_uuid(),
  brand_id        uuid not null references brands(id) on delete cascade,
  -- Signed: positive is a grant (starter, monthly allowance, purchased pack),
  -- negative is a debit (one metered AI call).
  delta           integer not null,
  reason          text not null check (reason in (
                    'starter', 'allowance_free', 'allowance_paid',
                    'pack_purchase', 'usage', 'manual_adjustment'
                  )),
  -- What caused it: a draft id for usage, a Stripe session/invoice id for a
  -- grant. Free-text because it spans namespaces; not a foreign key.
  source_id       text,
  -- The idempotency guarantee. A retried Stripe webhook or a double-fired cron
  -- collapses onto the same key and the second insert is a no-op, so a customer
  -- can never be double-granted or double-charged.
  idempotency_key text not null unique,
  -- The real (pre-markup) USD this row represents, for reconciliation against
  -- app_logs.estimated_usd and for margin reporting. Null on grants.
  usd_reference   numeric,
  created_at      timestamptz not null default now()
);

create index if not exists idx_credit_tx_brand_created
  on credit_transactions(brand_id, created_at desc);

create table if not exists credits_balance (
  brand_id              uuid primary key references brands(id) on delete cascade,
  -- The check is the backstop, not the gate: the RPCs clamp at 0 so a burst of
  -- concurrent debits can never drive this negative and trip it.
  balance               integer not null default 0 check (balance >= 0),
  -- 'YYYY-MM' of the last monthly allowance grant. The cron compares against
  -- the current month, so a double-fire in the same month grants nothing.
  last_allowance_period text,
  updated_at            timestamptz not null default now()
);

-- ── Billing state (Stripe mirror) ────────────────────────────────────────────

create table if not exists brand_billing (
  brand_id             uuid primary key references brands(id) on delete cascade,
  stripe_customer_id   text unique,
  stripe_subscription_id text,
  plan_code            text not null default 'free' check (plan_code in ('free', 'pro')),
  status               text,             -- Stripe's subscription status, verbatim
  current_period_end   timestamptz,
  updated_at           timestamptz not null default now()
);

create index if not exists idx_brand_billing_customer
  on brand_billing(stripe_customer_id);

-- ── Tunable economics (single row) ───────────────────────────────────────────

create table if not exists billing_config (
  id                    integer primary key default 1 check (id = 1),
  credits_per_usd       integer not null default 100,    -- 1 credit = $0.01
  markup_multiplier     numeric not null default 2.0,    -- real cost -> charged
  starter_credit_grant  integer not null default 2000,   -- ~$20 face, once
  free_monthly_allowance integer not null default 1000,  -- ~$10 face / month
  paid_monthly_allowance integer not null default 10000, -- ~$100 face / month
  -- [{id, credits, price_usd, stripe_price_id}] — the prepaid packs on offer.
  packs                 jsonb not null default '[]'::jsonb,
  updated_at            timestamptz not null default now()
);

insert into billing_config (id) values (1) on conflict (id) do nothing;

-- ── The only two things allowed to move a balance ────────────────────────────
--
-- Both are security definer so they run with the owner's rights: once RLS lands
-- (roadmap Step 3) the tables stay locked and these remain the only door.
--
-- The idempotency shape is the whole point. The insert carries the unique key
-- and `on conflict do nothing`; FOUND is true only when a row was ACTUALLY
-- inserted, so a replayed grant/debit skips the balance update entirely. Doing
-- it in that order (ledger first, cache second) means the audit table can never
-- disagree with the balance in the direction that costs the customer money.

create or replace function grant_credits(
  p_brand  uuid,
  p_delta  integer,
  p_reason text,
  p_source text,
  p_idem   text
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance integer;
begin
  if p_delta <= 0 then
    raise exception 'grant_credits: p_delta must be positive (got %)', p_delta;
  end if;

  insert into credit_transactions (brand_id, delta, reason, source_id, idempotency_key)
  values (p_brand, p_delta, p_reason, p_source, p_idem)
  on conflict (idempotency_key) do nothing;

  if not found then
    -- Replay: the grant already landed. Return the balance unchanged.
    select balance into v_balance from credits_balance where brand_id = p_brand;
    return coalesce(v_balance, 0);
  end if;

  insert into credits_balance (brand_id, balance, updated_at)
  values (p_brand, p_delta, now())
  on conflict (brand_id) do update
    set balance = credits_balance.balance + excluded.balance,
        updated_at = now()
  returning balance into v_balance;

  return v_balance;
end;
$$;

create or replace function debit_credits(
  p_brand  uuid,
  p_delta  integer,      -- positive magnitude; stored as a negative row
  p_reason text,
  p_source text,
  p_idem   text,
  p_usd    numeric default null
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance integer;
begin
  if p_delta <= 0 then
    raise exception 'debit_credits: p_delta must be positive (got %)', p_delta;
  end if;

  insert into credit_transactions (brand_id, delta, reason, source_id, idempotency_key, usd_reference)
  values (p_brand, -p_delta, p_reason, p_source, p_idem, p_usd)
  on conflict (idempotency_key) do nothing;

  if not found then
    select balance into v_balance from credits_balance where brand_id = p_brand;
    return coalesce(v_balance, 0);
  end if;

  -- greatest(0, ...) is what makes concurrent debits safe: the pre-check
  -- (hasSufficientCredits) is the real gate, and a burst that slips past it
  -- lands here and floors at zero instead of violating the check constraint and
  -- throwing inside a fire-and-forget debit.
  insert into credits_balance (brand_id, balance, updated_at)
  values (p_brand, 0, now())
  on conflict (brand_id) do update
    set balance = greatest(0, credits_balance.balance - p_delta),
        updated_at = now()
  returning balance into v_balance;

  return v_balance;
end;
$$;
