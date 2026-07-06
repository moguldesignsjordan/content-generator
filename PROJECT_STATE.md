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

## Session 2026-07-06: live verification sweep + 4 bugs found and fixed

Logged in via Playwright MCP and drove the "Not yet verified" checklist below
for real. Found and fixed four real bugs along the way (all uncommitted,
working tree not clean — see "Next step"). `npm run typecheck`, `npx vitest
run` (82 tests, up from 76), and `npm run build` all pass after every fix.

1. **Login silently hung on every sign-in** (`app/(auth)/login/login-card.tsx`
   `finish()`): called `router.refresh()` immediately followed by
   `router.push(redirectTo)` — a Next.js App Router race where `refresh()`
   can drop the pending `push()`, leaving the "Sign in" button spinning
   forever even though the Supabase auth call succeeded (confirmed via
   network log: `POST /auth/v1/token` returned 200, session cookie was valid,
   but the URL never left `/login`). Fixed by replacing both calls with a
   single hard `window.location.href = redirectTo`, which forces a fresh
   request through middleware, no client-router race possible. Verified:
   sign out → sign in now lands on `/` immediately.
2. **Email hero-image "Below headline" / "Above button" placements were
   silently broken** (`lib/email/hero-image.ts`): every real email template
   wraps each region in its own `<tr><td data-region="...">`, but the splice
   inserted a bare `<div data-region="image">` as a stray sibling between
   `</td>` and `</tr>` — invalid table markup. Browsers (and presumably real
   mail clients) "foster parent" that div out of the table entirely, so it
   always rendered above the whole card regardless of the chosen placement.
   "Top" only ever looked correct by coincidence (foster-parenting relocates
   to the same spot "top" wants anyway). The existing unit tests never caught
   this because the `TAGGED` test fixture used bare `<div>`/`<h1>` regions,
   not real `<td>`-in-`<tr>` markup. Fixed: `spliceHeroImage`/`removeHeroImage`
   now detect a `<td>` anchor and insert/remove a whole `<tr><td
   data-region="image">` row instead of a bare div (bare-div path kept as a
   fallback for untagged documents). Also fixed the generation prompt
   (`prompts/email-design.ts`) that told Claude to emit the same invalid bare
   div. Added 6 new regression tests in `hero-image.test.ts` against a
   realistic table fixture (`TAGGED_TABLE`) that would have caught this.
   Verified live: moved a real generated image to "Above button," downloaded
   the HTML, confirmed a well-formed `<tr><td data-region="image">` row
   sitting correctly right before the CTA row.
3. **Sanity's `.env` fallback was unreachable** (`app/(dashboard)/drafts/[id]
   /page.tsx`): `sanityConfigured` was computed as `integration ?
   resolveSanityConfig(integration) !== null : false` — when no brand-level
   Connections entry exists (the normal case, since Sanity keys are only in
   `.env.local`), it hard-coded `false` instead of calling
   `resolveSanityConfig(null)`, even though that function was written to
   accept `null` and fall back to `process.env.SANITY_*` (exactly what the
   file's own comment promises, and exactly how the MailerLite check right
   below it does it correctly). Result: the "Send to Sanity" button never
   appeared for any blog, ever, despite valid env keys. One-line fix:
   `sanityConfigured = resolveSanityConfig(integration) !== null`. Verified
   live: button appeared, published a real approved blog draft to Sanity as a
   draft doc, then queried Sanity's API directly and confirmed the doc
   carries `mainImage` with the correct asset reference and alt text.
4. **Plan 2 analytics loop always returned zero stats**
   (`lib/publishing/providers/mailerlite.ts` `fetchStats`): read
   `data.data.stats` from MailerLite's `GET /campaigns/{id}` response, but a
   live call proved stats actually live at `data.data.emails[].stats` (keyed
   by `default_email_id` — a campaign can carry more than one email for A/B
   tests). The top-level `stats` key doesn't exist, so `fetchStats` silently
   returned `[]` every time, which is why "Refresh stats" always showed "No
   stats yet" even on a real campaign. Fixed the read path and the file's
   header comment (which documented the wrong shape). Verified live: the
   `/performance` route now returns real metric rows and the stat-card grid
   (Sent/Opens/Open rate/Clicks/Click rate) renders on the review screen.

**Also surfaced, not a code bug:** the one real MailerLite campaign in the DB
(`publications.status = 'sent'`) is actually still `status: "draft"` in
MailerLite itself — `recipients_count: 291`, all stats zero,
`cannot_be_scheduled_reason: "Cannot schedule due to active subscribers limit
reached"`. The publish code's error handling is correct (it only writes
`'sent'` when the `/schedule` call itself returns 2xx); this looks like
MailerLite accepted the schedule request and then failed to actually deliver
afterward, likely an account/plan subscriber-limit issue. **Jordan: check the
MailerLite account for a subscriber-limit or billing block** — this explains
why a "sent" email apparently never reached anyone.

### What's now confirmed live (was "not yet verified")

- Brand guidelines document: renders correctly (existing guidelines), variant
  switcher (Bold Spectrum / Clean Minimal) both render distinctly correct,
  Download .html works. **Still open:** the from-scratch "Generate → edit →
  Save" combined-identity path specifically for a brand with *no* colors set
  yet — this brand already has colors, so that exact path wasn't
  re-exercised.
- Email image tool: generate (Top), move (Below headline, Above button, both
  now correct post-fix), all via the real Gemini pipeline.
- Blog image → approve → publish to Sanity → `mainImage` present with correct
  asset ref: confirmed via a live Sanity API query.
- Dark mode: confirmed visually via screenshot (proper dark background,
  contrast, gradient bar) on a real generated email.
- Settings → Connections: saved a fake Sanity key → "Connected via your
  account" banner appeared correctly → Disconnect → confirmed dialog →
  falls back to "Using server default (.env)" cleanly.
- Content subtype override: set "Announcement" on a real topic via `/create`,
  generation succeeded, quality check passed (DB-column confirmation wasn't
  possible without direct Postgres access, only the UI-level override path
  was exercised).
- Plan 4 durable generation runs, degraded path: a normal single-tab Generate
  works identically now that the DB-lock code exists but migration 009 isn't
  applied yet — confirms the degrade-to-always-acquire guarantee holds.
- Plan 2 analytics loop: fully live-verified end to end (see bug #4 above).

### Still open / blocked (not code, needs Jordan)

- **MailerLite "Send now" / "Schedule for later" real click-through**: still
  not click-tested this session (by design — sending a real campaign to real
  subscribers needs Jordan's explicit go-ahead, not an autonomous action).
  Given the subscriber-limit issue surfaced above, worth checking the
  MailerLite account before testing this.
- **Slice 4 keyword research**: still blocked on (1) migration 008 not
  applied to the live Supabase DB, (2) `DATAFORSEO_LOGIN`/`DATAFORSEO_PASSWORD`
  are now **empty** in `.env.local` (previously present-but-invalid; now
  blank) — get real credentials from app.dataforseo.com.
- **Migration 009** (durable generation lock) still not applied — apply
  `db/migrations/009_generation_runs.sql` in the Supabase SQL editor to get
  the actual cross-instance lock live (today it safely degrades).
- Onboarding auto-images question / Settings → Visual identity toggle: not
  re-checked this session.

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

1. **Working tree is currently dirty** with the 4 bug fixes from the
   2026-07-06 session (login hang, hero-image placement, Sanity env
   fallback, MailerLite stats path) — review and commit/push those; they're
   small, well-tested, and independent of each other. Local branch is also 3
   commits ahead of `origin/feat/dashboard-create-agent` (Plans 1, 2, 4) —
   not yet pushed.
2. Check the MailerLite account for the subscriber-limit/billing issue
   surfaced above (a "sent" campaign that never actually delivered).
3. Apply `db/migrations/008_topic_keyword_data.sql` and
   `db/migrations/009_generation_runs.sql` in the Supabase SQL editor, and
   get real `DATAFORSEO_LOGIN`/`DATAFORSEO_PASSWORD` credentials (currently
   blank in `.env.local`) from app.dataforseo.com.
4. Remaining "Not yet verified" items: the from-scratch brand-guidelines
   generate path (no colors set), onboarding auto-images toggle, and an
   actual MailerLite "Send now"/"Schedule" click-through (Jordan's call, see
   above).
5. Pick up the next plan from the 7-plan improvement doc
   (`~/.claude/plans/refactored-snacking-lightning.md`) — Plans 1, 2, and 4
   are code-complete and now largely live-verified; good next candidates are
   Plan 5 (blog editorial parity, independent) or Plan 6 (recurring
   automation, now unblocked by Plan 4).

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
