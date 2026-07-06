# Project State

Living save/restore doc. Read this first to pick up context; update it
whenever progress, blockers, or decisions change. Keep this file short:
implementation detail (file paths, function names, "verified live" blow-by-
blow) belongs in git history and the code itself, not here. `git log
--oneline -20` is the changelog; this file is decisions + current state +
what's genuinely still open.

Last updated: 2026-07-06.

## Locked decisions

- One brand for now (Mogul Design Agency); shaped so multi-brand is a config
  change later, not a rewrite.
- Strategy is data (Postgres rows), not code — see `automated-content-engine-plan.md` §7.
- Draft model is `claude-sonnet-4-6` (`DRAFT_MODEL` in `lib/clients/anthropic.ts`);
  don't swap without reason.
- The human-approval gate is mandatory — nothing publishes without an
  explicit approve action. No auto-publish.
- MailerLite emails must always carry the `{$unsubscribe}` merge tag
  (enforced in `lib/pipeline/generate.ts` — preserve this guarantee).
- Server-only boundary is enforced (`server-only` import) in `lib/db/client.ts`,
  `lib/db/queries.ts`, `lib/clients/anthropic.ts`, `lib/pipeline/` — keep new
  secret-touching code behind it.
- No em-dashes/en-dashes in any generated or written copy — use commas,
  colons, or "to" instead.
- Auth: real Supabase Auth gates the whole app; data itself stays
  single-tenant via the existing service-role client (`lib/db/client.ts`).
  Per-user RLS is a deliberately deferred later layer.
- Build one vertical slice at a time per `v1-build-guide.md`; don't build
  ahead of the current slice.
- AI proposes, the human approves: brand-brain writes only happen on an
  explicit Save/confirm (settings suggest, campaign-chat voice proposals,
  guidelines synthesis all follow this contract).
- Publishing is built as a provider-agnostic layer (`lib/publishing/`);
  per-brand credentials are still required and nothing sends without the
  human clicking Publish in the app. For MailerLite specifically, that one
  click now drives the actual send/schedule too (instant or a chosen future
  time), so there's no second manual step inside MailerLite's own dashboard,
  by Jordan's explicit call on 2026-07-05 (still one explicit human act, just
  not a second one in a different system). Sanity/blog publishing has no
  scheduling concept and still just creates a draft doc.

## Current state (as of `3259d95`, pushed to `origin/feat/dashboard-create-agent`)

The core pipeline is built end-to-end for both channels and the working tree
is clean — everything below is committed and pushed, not pending.

- **Email pipeline:** topic → `POST /api/generate` → streamed generation
  (SSE progress, no fake loading copy) → structured draft (Claude, adaptive
  thinking) → review screen → approve/edit/reject-with-regenerate (capped at
  3 versions) → optional publish to MailerLite.
- **Blog pipeline:** same topic → long-form SEO draft → Portable Text
  (unit-tested markdown converter, `lib/blog/to-portable-text.ts`) → review
  (same preview HTML you'd publish) → publish to Sanity as a draft doc. Can
  be spun off directly from an existing email via "Create a blog post from
  this topic" (same topic, independent generation, email copy not reused by
  design). **Blog reject/regenerate and click-to-edit are not built yet**
  (email-only for now); approve/archive/delete/publish are.
- **Draft review/editing tools:** click-to-edit per region (wording, color,
  style) via find/replace patches (Haiku, falls back to Sonnet on a rare
  match miss); "Redesign" for a full from-scratch re-render when a change
  (e.g. background color) is baked into many literal spots at once; one
  shared server-side undo stack (`drafts.meta.style_edit_history`, capped at
  10) covering all edit types; CTA link field; download-as-.html.
- **Images (Gemini):** optional AI hero image per draft, three placement
  slots for email (top / below headline / above CTA, pure string-splice to
  move), pinned-under-title for blog. Reference-image support, style chips,
  manual upload. Opt-in per draft by default; an "auto-generate on first
  draft" brand preference exists (`visual_identity.image_gen`, set in
  onboarding or Settings → Visual identity) — regenerations never touch an
  existing or deliberately-removed hero. Approval gate applies same as copy.
- **Dark mode:** both the code-template and model-generated email HTML, plus
  the blog preview, carry real `prefers-color-scheme: dark` CSS (not just
  the meta tag) so mail clients don't auto-invert into something worse.
- **Publishing layer:** `lib/publishing/` provider abstraction (adding a
  platform = one adapter + one registry line); MailerLite and Sanity
  adapters; idempotent (`publications` unique per job+target, checked before
  any external call). **Settings → Connections** lets a brand store its own
  MailerLite/Sanity credentials, encrypted at rest (AES-256-GCM,
  `lib/crypto/secrets.ts`), with server `.env` values as a fallback when no
  per-brand connection is saved.
- **Brand brain UX:** onboarding chat, settings forms with non-persisting
  "Suggest with AI," import-from-website (scrape → proposal → reviewed
  merge), from-scratch brand identity generator (palette + font pairing) for
  brands with no site to import from, campaign-chat topic interview with
  quick-reply chips, a brand-readiness checklist on Home.
- **Brand guidelines document (new, not yet committed):** a visual, shareable
  rendering of the existing `brands.guidelines` + `visual_identity` +
  `positioning` data (no new AI call, no new DB column — this is a pure
  render layer over data that was already synthesized/approved/fed into the
  brain). `lib/brand-book/` has two selectable template variants (Bold
  Spectrum: dark, gradient-forward; Clean Minimal: light, editorial) built
  from shared section-builders (`lib/brand-book/shared.ts`) so both stay in
  sync. New route `/settings/brand-guidelines`: shows the existing
  Generate→edit→Save guidelines flow (fields extracted out of
  `guidelines-form.tsx` into a shared `guidelines-fields.tsx` so both surfaces
  use one implementation) if nothing's approved yet, otherwise the rendered
  document in an iframe with a variant switcher and a "Download .html"
  button (same Blob pattern as the email/blog review screens). The old
  standalone "Generate brand identity" Settings action (palette + font
  pairing only, for brands with no website) was folded into this same
  Generate step and its Sheet/form deleted: Settings' "Generate brand
  identity" row now links straight to `/settings/brand-guidelines`, and if
  the brand has no colors set yet, the page's one Generate button also calls
  `/api/settings/brand-identity` (same underlying logic, unchanged) alongside
  the guidelines synthesis, previews the proposed palette read-only, and
  saves both together on one Save click. Brands that already have colors
  skip that call, nothing regenerates an existing palette. Linked from
  Settings ("Generate brand identity") and from the onboarding completion
  screen ("Create your brand guidelines →"). Also extracted
  `lib/color/contrast.ts` (luminance/contrast/readableTextColor) out of
  `lib/pipeline/brand-identity.ts` so the swatch-legibility math isn't
  duplicated a third time.
- **Housekeeping:** archive (soft-hide, any status) and hard-delete
  (blocked once a job has a `publications` row — archive instead) for both
  topics and drafts, with inline per-row actions on the Emails/Blogs lists;
  server-enforced banned-terms + WCAG-AA contrast QA gates on approve.
- **Content subtype (email_type/blog_type):** derived per-type length budgets
  (`EMAIL_LENGTH_TARGETS`/`BLOG_LENGTH_TARGETS`) plus, as of migration 005
  (applied), the `content_jobs.email_type`/`blog_type` columns are fully
  wired: `createDraftShell` can set one explicitly to override derivation,
  `getDraftWithJobContext` reads it back, `resolveEmailType`/`resolveBlogType`
  honor a non-null value instead of deriving, and every generation/regen path
  (`populateDraft`, `persistRegeneratedDraft`) backfills the column with the
  resolved type either way. `/api/generate` accepts `emailType`/`blogType` in
  the body so the override is directly testable; no settings-form UI to pick
  one yet (optional, still open).
- Env keys present in `.env.local`: Supabase, Anthropic, Gemini, MailerLite,
  Sanity, DataForSEO, `INTEGRATION_ENCRYPTION_KEY`. Migrations 004
  (`brand_integrations`) and 005 (`email_type`/`blog_type`) confirmed applied
  to the live Supabase DB.
- **MailerLite direct send/schedule (new, migration applied, UI not yet
  click-tested):** Publish on an approved email now calls MailerLite's real
  `POST /campaigns/{id}/schedule` right after creating the campaign (verified
  against developers.mailerlite.com), instead of stopping at a draft campaign
  the user had to finish inside MailerLite. Two controls on the drafts review
  screen: "Send now" (instant delivery) and "Schedule for later" (a
  `datetime-local` picker, no timezone field, relies on MailerLite's own
  account-default timezone). `publications` has two new columns (migration
  006, **confirmed applied to the live DB 2026-07-05** via a direct REST
  query): `status` ('sent' | 'scheduled' | 'draft') and `scheduled_for`. If
  the schedule call fails after the campaign was already
  created, `publish()` returns `status: "draft"` instead of throwing (so a
  retry never double-creates the campaign in MailerLite) and the UI shows a
  "created but not scheduled, finish it in MailerLite" warning with a link,
  since there's no in-app retry-just-the-schedule path yet.
- **Slice 4 — DataForSEO keyword research, "enrich" cut (committed
  `2326900`, migration NOT yet applied):** validates the keyword a topic
  already carries against real DataForSEO numbers, on an explicit per-topic
  "Research" tap (no auto-spend). `db/migrations/008_topic_keyword_data.sql`
  adds `topics.keyword_data` (jsonb), mirrored in `db/schema.sql`.
  `lib/clients/dataforseo.ts` (server-only, Basic Auth) + `lib/keyword/
  research.ts` (`researchKeyword`, 4 Live calls: google_ads/search_volume,
  dataforseo_labs bulk_keyword_difficulty, search_intent, related_keywords
  for secondary suggestions) + `lib/keyword/normalize.ts` (pure normalizer,
  unit-tested, kept free of the "server-only" import chain so Vitest can
  import it directly). `POST /api/topics/[id]/research` persists onto the
  topic; `POST /api/keywords/research` validates a raw keyword for an
  unsaved topic-idea proposal (Suggest topics). `prompts/brand-voice.ts
  buildKeywordLines` (unit-tested) swaps the generation brief's bare TARGET
  KEYWORD/SEARCH INTENT lines for validated figures + a SECONDARY KEYWORDS
  line once a topic has been researched; wired into both
  `generate-email.ts` and `generate-blog.ts`. UI: `KeywordBadge` (colored
  vs `seo_defaults.keyword_difficulty_max`) replaces a "Research" link on
  `cluster-card.tsx` once researched; `suggest-topics.tsx` gets the same
  per-proposal Research link (against the raw-keyword route, since a
  proposal isn't a topic row yet).
- **Plan 2 — Analytics loop, the `performance` table (new, not yet
  committed):** closes strategy → content → publish → measure. The
  `performance` table has existed since schema v1 but nothing wrote to it
  until now. `lib/publishing/provider.ts` gains an optional
  `fetchStats(input): Promise<PerformanceMetric[]>` on `PublishProvider`
  (`PerformanceMetric` lives in `lib/db/types.ts` alongside the other row
  shapes, imported by the publishing layer, not the reverse). MailerLite's
  adapter implements it via `GET /campaigns/{id}` (verified against
  developers.mailerlite.com: `stats.sent`, `unique_opens_count`,
  `open_rate.float`, `unique_clicks_count`, `click_rate.float`, rate fields
  are `{float, string}` objects, not plain numbers). Sanity/blog leaves
  `fetchStats` unimplemented (blog metrics deferred to Google Search
  Console). `lib/db/queries.ts` gets `recordPerformance` (appends a
  snapshot row per metric, time-series, no upsert) and
  `getLatestPerformance` (newest row per metric via `MAX(fetched_at)`,
  computed in JS after an ORDER BY, not SQL DISTINCT ON). New
  `lib/pipeline/performance.ts` (`refreshPerformance`/
  `getPerformanceForDraft`) mirrors `publish.ts`'s resolution shape
  (publication → provider → brand/integration). New
  `app/api/drafts/[id]/performance/route.ts`: POST refreshes from
  MailerLite, GET reads the last-fetched snapshot with no external call
  (so loading the review screen doesn't spend a refresh). UI: new
  `performance-stats.tsx` (`StatCard` grid + "Refresh stats" button) renders
  inside the existing MailerLite publish card on `review-actions.tsx` once
  `publication.external_id` exists. Blog review screen is untouched (no
  Sanity stats yet). `npm run typecheck`, `npm run build`, `npx vitest run`
  (76 tests, unchanged, no new tests added for this cut) all pass.
- **Plan 4 — Durable generation runs (new, not yet committed, migration NOT
  yet applied):** replaces the single-instance-only dedupe in
  `lib/pipeline/generation-runs.ts` with a DB-backed lock, so a
  multi-instance deploy can't start two Claude calls for the same draft. New
  `generation_runs(draft_id primary key, status, started_at, heartbeat_at)`
  table (`db/migrations/009_generation_runs.sql`, mirrored in
  `db/schema.sql`). `lib/db/queries.ts` gains `acquireGenerationLock`
  (insert-or-steal-on-stale-heartbeat; a heartbeat older than 6 minutes,
  comfortably above the route's 300s maxDuration, means the owning instance
  died mid-run) / `releaseGenerationLock` / `getDraftGenerationState` (cheap
  meta-only read). Both lock functions **degrade to "always acquired"** if
  `generation_runs` doesn't exist yet (checks for Postgres's 42P01 /
  "does not exist"), so shipping this code can never break generation against
  a stale schema before the migration lands. `patchDraftGeneration` now also
  bumps the lock's heartbeat, best-effort. `generation-runs.ts` keeps the
  in-memory `Map` as the same-instance fast path unchanged; when an instance
  loses the cross-instance lock race, it polls `drafts.meta.generation` every
  2s (capped at 280s, just under the route's 300s maxDuration) and emits the
  same phase/done/error events, so `useGenerationStream`/`GenerationProgress`
  need zero changes. `npm run typecheck`, `npm run build`, `npx vitest run`
  (76 tests, unchanged, no new tests added — this repo's tests are pure-
  function normalizers/converters, not DB-touching query helpers) all pass.

**Known limitations (by design or deferred, not bugs):**
- Regenerating/redesigning a draft never re-triggers auto-image; only the
  first generation does.
- Seeded topics still map to placeholder product slugs, not real products
  (7 real products are live in Supabase — see memory
  `project-pending-product-save`).

## Not yet verified

Nothing here is blocked on infra (keys/migration/commit are all done) — this
is purely "click through it as the logged-in user":
- **Brand guidelines document** (see above, including the "Generate brand
  identity" merge): `npm run typecheck` + `npm run build` + `npx vitest run`
  all pass after both rounds of changes, and `renderBrandBookTemplate` was
  exercised directly (outside the app) with realistic sample data for both
  variants, confirming the section pipeline and CSS produce a correct,
  complete document. `.mcp.json` now has a `playwright` MCP server entry for
  real browser click-through, but it wasn't connected in the session that
  built this (needs a Claude Code session restart to pick up a newly-added
  MCP server) — not yet used to verify. Still needs a live click-through:
  Generate → edit → Save on a real brand with no guidelines/colors yet
  (confirms the combined identity+guidelines path and the two PATCH calls
  both land), the variant switcher and Download button, and the onboarding
  completion CTA.
- Email image tool: add/move/regenerate at all three placements.
- Blog: "+ Add image," approve → publish to Sanity, confirm the doc carries
  `mainImage`.
- Onboarding asks the auto-images question; Settings → Visual identity shows
  the toggle.
- A generated email and blog both render correctly in dark mode (macOS dark
  appearance).
- Settings → Connections: save a fake MailerLite/Sanity key, confirm the
  "Connected via your account" banner, disconnect, confirm fallback to
  ".env default"; one real end-to-end publish on each channel with connected
  credentials.
- Content subtype override: POST `/api/generate` with an explicit `emailType`
  (or `blogType`) and confirm the draft honors it instead of deriving one, and
  that `content_jobs.email_type`/`blog_type` end up populated either way
  (overridden or plain-derived) after generation.
- **MailerLite direct send/schedule:** migration 006 is applied (confirmed
  live), but the actual click-through was skipped by Jordan's choice on
  2026-07-05 (no logged-in browser session available at the time). Still
  needs: with a real MailerLite key + sender + at least one group, click
  "Send now" on an approved email and confirm it actually sends (not just
  creates a draft campaign); click "Schedule for later," pick a future time,
  confirm MailerLite shows it as scheduled at roughly that time; force a
  schedule failure (e.g. a campaign with no group set) and confirm the UI
  shows the "created but not scheduled" warning instead of crashing or
  silently succeeding.
- **Slice 4 keyword research is code-complete but blocked on two things
  outside this session's reach:** (1) **migration 008 has NOT been applied**
  to the live Supabase DB (`topics.keyword_data` doesn't exist yet, confirmed
  via a direct REST query, `column topics.keyword_data does not exist`) —
  paste `db/migrations/008_topic_keyword_data.sql` into the Supabase SQL
  editor before using Research on a real topic. (2) **The
  `DATAFORSEO_LOGIN`/`DATAFORSEO_PASSWORD` values currently in `.env.local`
  are not valid**: direct live calls to `api.dataforseo.com` (and the
  sandbox host, and the plain `appendix/user_data` account-info endpoint)
  all returned `40100 "You are not Authorized to Access this Resource"` at
  $0 cost (no spend happened) — check/regenerate credentials at
  app.dataforseo.com before relying on Research. Everything else is
  verified: `npm run typecheck`, `npm run build`, and `npx vitest run` (76
  tests, including new `research.test.ts` and `brand-voice.test.ts` cases for
  `normalizeKeywordData`/`buildKeywordLines`) all pass. The actual browser
  click-through (tap Research, confirm the badge, generate and confirm the
  brief cites real numbers) hasn't happened yet: Supabase Auth gates every
  route including the API ones, and no logged-in session was available in
  this session to drive Playwright with.
- **Plan 2 analytics loop: not live-verified.** Needs a real, already-sent
  MailerLite campaign to test against (the "Refresh stats" button calls a
  real `GET /campaigns/{id}`, and MailerLite's own stats only populate after
  actual sends/opens/clicks happen) plus a logged-in browser session,
  neither available in this session. Code paths (`fetchStats`,
  `recordPerformance`/`getLatestPerformance`, the route, the UI) are
  typecheck/build-clean but unexercised end to end.
- **Plan 4 durable generation runs: not live-verified, blocked on migration
  009 not yet being applied.** Until `db/migrations/009_generation_runs.sql`
  is applied to the live Supabase DB, the code deliberately degrades to the
  old always-acquire single-instance behavior (that's the point — shipping
  it can't break generation today), so a normal single-tab Generate should
  behave identically to before; that path wasn't click-tested this session
  (no logged-in browser session available). Once migration 009 is applied,
  still needs: simulate two concurrent `generate-stream` opens for one draft
  (two tabs, or two `curl`s) and confirm only one Claude call actually runs;
  kill the owning process mid-run (or just wait past the ~6 minute stale
  window) and confirm a retry can still acquire the lock and complete.

## What's not built yet

- Settings-form UI to pick an email_type/blog_type override per topic/job
  (the backend override path is wired; nothing in the UI sets it yet) or to
  tune per-type word targets.
- Blog reject/regenerate + click-to-edit for blog drafts (email has both).
- In-app retry for a MailerLite campaign stuck in `status: "draft"` (schedule
  call failed after the campaign was created) — today the fix is manual,
  inside MailerLite.
- A recurring/automated email series (e.g. "every Monday, auto-generate and
  send") — what's built is per-email scheduling, each one still approved and
  triggered individually; no scheduler that also triggers generation.
- **Slice 7 — Distribution/repurposing checklist:** not started.
- Feeding performance back into topic selection (surfacing "what's working"
  in `buildTopicLines`/`suggest-topics`) — deliberate phase 2 for the
  analytics loop, once real performance data exists to feed it.
- Google Search Console / blog performance metrics (Sanity's `fetchStats`
  is unimplemented on purpose).
- A Vercel cron to auto-refresh performance (today it's an explicit tap only).
- **Multi-tenancy + RLS (Tier 3)** — deliberately out of scope, the one true
  blocker to selling this as SaaS.
- Topic remap: seeded topics still map to placeholder product slugs.

## Next step

1. Apply `db/migrations/008_topic_keyword_data.sql` and
   `db/migrations/009_generation_runs.sql` in the Supabase SQL editor, and
   fix/regenerate the `DATAFORSEO_LOGIN`/`DATAFORSEO_PASSWORD` credentials in
   `.env.local` (all three currently block Slice 4 and Plan 4 from being
   fully live-verified, see "Not yet verified").
2. Jordan clicks through the "Not yet verified" list above in a logged-in
   browser session, including the Slice 4 Research flow and the Plan 4
   cross-instance lock test once 1 is done, and the Plan 2 "Refresh stats"
   flow once a real email has actually been sent via MailerLite.
3. Pick up the next plan from the 7-plan improvement doc
   (`~/.claude/plans/refactored-snacking-lightning.md`) — Plans 1, 2, and 4
   are now code-complete (live-verification pending per above); good next
   candidates are Plan 5 (blog editorial parity, independent) or Plan 6
   (recurring automation, now unblocked by Plan 4) — or Plan 7 (verification
   sweep) to close out the pending live-verification backlog first.

## How to verify this doc against reality

This file is written from a point-in-time read of the repo. Before trusting
a claim above, spot-check it:

- `git log --oneline -20` and `git status` — confirms what's actually
  committed/pushed vs. still in progress.
- `ls db/migrations/` — confirms which migrations exist; check the live
  Supabase SQL editor (or `curl` the REST API for a table introduced by the
  newest one) to confirm which have actually been applied.
- `grep -oE '^[A-Z_]+=' .env.local` — confirms which env vars are actually
  set locally (never print the values).
