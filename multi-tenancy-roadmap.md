# Multi-tenancy roadmap: from "Jordan's tool" to "many users' tool"

Today the app is single-tenant by a deliberate locked decision: Supabase Auth
gates who can get in, but once in, every query runs through the service-role
client (`lib/db/client.ts`) against one shared dataset. Any logged-in user
sees THE brand, not THEIR brand. This doc is the concrete path out of that,
ordered so each step ships alone and nothing needs a rewrite. The schema was
shaped for this from day one (everything already hangs off `brands.id`), so
this is additive work, not surgery.

## Step 0 — What already works in our favor

- Every table chains to `brands` through foreign keys (`strategies.brand_id`
  → pillars → clusters → topics → content_jobs → drafts → ...), so "scope by
  brand" is one join away everywhere.
- Publishing credentials are already per-brand (`brand_integrations`,
  encrypted), with `.env` as fallback. Multi-user just means the fallback
  stops being acceptable for non-Jordan brands.
- The pipeline never hardcodes the brand; `getBrandStrategy()`-style helpers
  resolve it at request time. The single-tenant assumption lives in a small
  number of "get THE brand" query helpers, not spread across the app.

## Step 1 — Membership: who owns which brand

New table, one migration:

```sql
create table brand_members (
  brand_id uuid references brands(id) on delete cascade,
  user_id  uuid references auth.users(id) on delete cascade,
  role     text not null default 'owner' check (role in ('owner','editor','viewer')),
  created_at timestamptz not null default now(),
  primary key (brand_id, user_id)
);
```

Backfill: one row linking Jordan's auth user to the Mogul brand. Onboarding
(`/onboarding` brand creation) inserts a membership row for the creating user.

## Step 2 — Resolve the brand from the session, not "the first row"

Replace the "get THE brand" helpers in `lib/db/queries.ts` with
`getBrandForUser(userId)` (join through `brand_members`). The route handlers
already run behind Supabase session middleware, so the user id is available
server-side everywhere. This is the single biggest code change and it's
mechanical: every helper that starts "select the brand" gains a `userId`
parameter. Keep the service-role client for now; scoping is done in the
query layer. A user with zero brands lands on onboarding, which already
exists and already builds a brand from nothing.

## Step 3 — RLS as the safety net (defense in depth)

Turn on Row Level Security with policies driven by `brand_members`, then move
reads/writes from the service-role client to a per-request client created
with the user's JWT (`@supabase/ssr` already in the stack for auth). Pattern
per table: `using (brand_id in (select brand_id from brand_members where
user_id = auth.uid()))`, with the deeper tables (topics, drafts...) checking
via their parent chain or a denormalized `brand_id` column added where the
join is too deep (drafts/content_jobs are the candidates).

Service-role stays only for: cron (`/api/cron/run-schedules`), storage bucket
management, and the seed script. Everything user-facing goes through RLS.
After this step a query bug can no longer leak one tenant's data to another.

## Step 4 — Per-tenant cost controls (the ai-guard grows up)

`lib/ai-guard.ts` currently rate-limits per operation and budgets globally
via `DAILY_SPEND_LIMIT_USD`. Multi-user needs:

- `app_logs` gains a `brand_id` column so usage rows attribute spend to a
  tenant (the write path in `lib/log.ts` already accepts context; this is a
  column + a few call sites).
- Budget check becomes per-brand: `sum(estimated_usd) where brand_id = X and
  created_at > now() - '24h'` against a per-brand cap (a `brands.limits`
  jsonb field), with the global cap kept as the house-wide breaker.
- Rate-limit keys become `${operation}:${brandId}`.

This is also the metering foundation if this ever becomes paid SaaS: the
usage rows ARE the billing meter.

## Step 5 — The things that stop being shared

- **Storage:** prefix `content-images` object paths with the brand id
  (`{brandId}/{ts}-{rand}.jpg`) so a bucket listing can't cross tenants and
  per-tenant cleanup is a prefix delete.
- **Env-fallback credentials:** MailerLite/Sanity/`GEMINI_API_KEY` fallbacks
  in `.env` are Jordan's accounts. Gate the fallback to the Mogul brand id
  (or an `is_house_brand` flag); every other brand must connect their own in
  Settings → Connections, which already works.
- **Cron:** `runDueSchedule` iterates all due schedules already; it just
  needs to resolve each schedule's brand rather than THE brand (it largely
  does, via the schedule row's brand_id).

## Step 6 — Optional, when it's real SaaS

- Email verification + invite flow (add a member to a brand by email).
- Per-seat roles actually enforced (editor can't change Connections, viewer
  can't approve).
- Stripe metering off the app_logs usage rows.
- A `plans` table gating schedule count / drafts per month.

## Suggested order of attack

1 + 2 together are one working session and make the app genuinely multi-user
(correctness). 3 is a second session (safety). 4 is a third (economics).
5 fits in the cracks. Nothing blocks shipping the current single-tenant app
to production today; this ladder is climbed when a second real user exists.
