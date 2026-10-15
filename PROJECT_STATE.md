# Project State

Living save/restore doc. Read this first to pick up context; update it
whenever progress, blockers, or decisions change. Keep this file short:
implementation detail (file paths, function names, "verified live" blow-by-
blow) belongs in git history and the code itself, not here. `git log
--oneline -20` is the changelog; this file is decisions + current state +
what's genuinely still open. When a session ends, edit the sections below
rather than appending a new session log.

Last updated: 2026-10-14. Everything is committed and pushed to `main`
(latest `0406130`). Trimmed from a 1,700-line session log; the old entries
are in git history (`git log -p PROJECT_STATE.md`).

## Locked decisions

- One brand UI for now (Mogul Design Agency), with billing and per-brand data
  already multi-tenant. Full per-user RLS is still deferred
  (`multi-tenancy-roadmap.md`).
- Strategy is data (Postgres rows), not code: see
  `automated-content-engine-plan.md` §7.
- Models (`lib/clients/model-ids.ts`): `DRAFT_MODEL` = `claude-sonnet-5`,
  `HARD_MODEL` = `claude-opus-5`, `FAST_MODEL` = Haiku 4.5. Emails use no Opus
  by default; the Opus design critique is opt-in per brand.
- Images: default Nano Banana 2.1, Pro tier available. GPT Image 2.5 shows up
  only when `OPENAI_API_KEY` is set.
- The human-approval gate is mandatory. Nothing publishes without an explicit
  approve plus publish click. The one MailerLite click sends or schedules for
  real (Jordan's call, 2026-07-05). Approved blogs publish live to Sanity
  (Jordan's call, 2026-10-11).
- MailerLite emails always carry `{$unsubscribe}` (enforced in
  `lib/pipeline/generate.ts`).
- Server-only boundary is enforced (`server-only` import) on DB, Anthropic,
  and pipeline code.
- No em dashes or en dashes in any generated or written copy.
- AI proposes, the human approves: brand-brain writes only happen on an
  explicit Save.
- Publishing is a provider layer (`lib/publishing/`), idempotent per job +
  target.
- Web research in campaigns only runs when the owner says yes (enforced in
  code, not just the prompt).
- Competitor ads: only distilled strategy reaches copy prompts; competitor
  images reach the image model only inside a look the owner built, with a
  no-copying instruction.
- Flyers: art is text-free and code sets the text, except with a design look,
  where the image model designs the whole flyer and Haiku checks the spelling
  (one retry, then the code-set layout as a fallback).

## Current state

- **Create (`/`) is one chat.** Kind chips (Flyer, Email, Campaign, Blog, Ad)
  then the owner describes it; Claude reflects the details back, asks at most
  three missing items, and confirms. Streams over SSE. Campaigns hand off to
  the factory (research optional, editable plan, quote, "Test 3 first" or
  "Make all", approve-all).
- **Pipelines:** email (angle pick, draft, QA that revises once, optional
  design critique), blog (Portable Text, FAQ, internal links, live Sanity
  publish), flyers (4 options per click, design looks, FB/IG ad copy mode).
- **Review/editing:** click-to-edit regions, redesign, undo, CTA and image
  links, thumbs feedback and reviewer edits feeding the guidelines synthesis.
- **Publishing:** MailerLite send/schedule plus webhook-driven stats; Sanity;
  Facebook/Instagram posting code (not live, see below); a daily cron posts
  due social posts and runs recurring schedules.
- **Brand brain:** onboarding, settings, website import, brand guidelines
  doc, reference emails, email design references, competitor ad library
  (including Ad Library import via ScrapeCreators), design looks.
- **Billing:** credits ledger, paywall, Stripe Checkout for packs and Pro,
  monthly allowance cron.
- **Admin:** `/logs` and `/prompts`, gated by `user_profiles.role`.
- **Migrations:** all through 031 are applied (checked live 2026-10-14).
- **Checks:** `npm run typecheck`, `npm test` (723 tests), `npm run lint`
  (0 errors, 14 warnings), `npm run build`. `next build` runs lint, so a lint
  error now fails the deploy.

## Open: needs Jordan

1. **Local `ANTHROPIC_API_KEY` is invalid (401).** Every Claude call fails
   locally; production's key works. Replace it in `.env.local`.
2. **Logged-in click-through of the Oct 14 work** (none of it has been run end
   to end): the Create chat for each kind, a campaign with "Test 3 first"
   (spends roughly $0.15-0.40 plus the pieces), design looks and designed
   flyers, composed flyers on a brand whose font isn't on Google Fonts
   (falls back to Inter).
3. **Meta app for Facebook/Instagram.** `META_APP_ID`, `META_APP_SECRET`,
   `META_LOGIN_CONFIG_ID` aren't in Vercel. Public posting also needs App
   Review and likely Business Verification. Add the META vars to
   `.env.example`.
4. **Stripe:** `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are in Vercel,
   but `STRIPE_PRO_PRICE_ID` isn't and `billing_config.packs` is empty, so
   nothing is purchasable. Decide pricing, then test the webhook with real
   events.
5. **MailerLite:** no real "Send now"/"Schedule" has been done. An earlier
   "sent" campaign never delivered because the account hit its active
   subscriber limit; check the account before testing.
6. **SEO follow-through:** confirm mdawebsite's SEO changes are deployed, then
   publish one real blog from here and confirm it's live with its FAQ;
   submit the sitemap in Search Console; redirect www to the apex.
7. **Optional:** `OPENAI_API_KEY` (local + Vercel) to turn on GPT Image.

## Open: code (not started)

- Blog AI section-level copy editing (Plan 5 Phase B). Check with Jordan
  before starting.
- Feed performance (open/click rates) back into topic and angle selection
  beyond the current "top performing emails" ranking.
- In-app retry for a MailerLite campaign stuck as a draft after a failed
  schedule call.
- Google Search Console metrics for blogs.
- UI to pick an email/blog type override per topic.
- Seeded topics still map to placeholder product slugs.
- Remove the old screens the factory/chat redesign hid, once the new flow is
  confirmed live.
- Large files worth splitting when next touched: `lib/db/queries.ts`,
  `create-agent.tsx`, `review-actions.tsx`, `lib/pipeline/generate.ts`,
  `app/api/create/chat/route.ts`.

## Gotchas

- `vercel env pull` can't pull values stored as Secrets; they come down as
  `[SENSITIVE]` placeholders.
- Supabase CLI needs the project ref: `supabase db query --linked
  --project-ref stujpgjxhyivsqvnhdfs "..."` (or `--file`).
- If a localhost:3000 app renders garbled or stale in dev, unregister leftover
  Service Workers (StackBot shares the port) before assuming the code is
  broken.
- Meta's own Ad Library API only returns political/issue ads, so ads come
  through ScrapeCreators.
- Stripe SDK 22: `current_period_end` lives on subscription items, and an
  invoice's subscription is at `parent.subscription_details.subscription`.

## How to verify this doc against reality

- `git log --oneline -20` and `git status` for what's committed and pushed.
- `ls db/migrations/`, then query the live DB with the Supabase CLI above to
  confirm a migration's table or column exists.
- `vercel env ls production` for which env vars are set in production.
