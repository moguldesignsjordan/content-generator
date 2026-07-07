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
- **Migrations 008 and 009 confirmed applied** (2026-07-06, verified via a
  direct REST query): `topics.keyword_data` column exists, `generation_runs`
  table exists. Plan 4's cross-instance lock is now live (no longer just
  degrading); Slice 4 keyword research just needs real DataForSEO
  credentials to be fully usable — `DATAFORSEO_LOGIN`/`DATAFORSEO_PASSWORD`
  are still empty in `.env.local` (get them from app.dataforseo.com: account
  email + a separate API password from their API Access dashboard, pay-as-
  you-go billing).
- MailerLite "sent" vs "draft" mismatch (see above) is expected: Jordan is
  still testing, hasn't done a real send yet.
- Onboarding auto-images question / Settings → Visual identity toggle: not
  re-checked this session.

## Plan 5 — Blog editorial parity, Phase A (committed)

Blog drafts previously had only approve/archive/delete/publish + hero image
(the article itself was read-only v1); email already had reject/regenerate.
Phase A closes that gap: `regenerateBlogDraft` in
`lib/pipeline/generate-blog.ts` mirrors `regenerateEmailDraft`
(`lib/pipeline/generate.ts`) exactly — same version-cap check
(`MAX_DRAFT_VERSIONS`), same "not the active review target anymore" guard,
same reject-record-before-generating ordering, existing hero image carries
over unchanged. `buildBlogMessages` (`prompts/generate-blog.ts`) gained a
`rejection` option (feedback + previous title/meta description woven into
the prompt) mirroring `buildEmailMessages`'s block. `persistRegeneratedDraft`
(`lib/db/queries.ts`) now accepts an optional `blogType` alongside
`emailType` to backfill `content_jobs.blog_type` on a regenerated version.
`POST /api/drafts/[id]/reject` now dispatches by `draftCtx.jobType` to either
regenerate function instead of assuming email. `blog-review-actions.tsx`
gained the same Reject sheet, background-regeneration status card, and
disabled-state/tooltip logic as the email review screen (`review-actions.tsx`),
including the `isActionable`/`atCap`/`rejectedThisDraft` guards.

**Live-verified 2026-07-06:** spun off a fresh test blog post, rejected v1
with feedback ("make this feel more urgent and add a specific customer
example"), confirmed the sheet closed instantly and the background status
card showed correctly with Approve/Reject/Archive/Delete all disabled +
tooltipped. v2 landed with both requested changes: a concrete customer story
(response time 3 days → 15 minutes, 40% conversion lift, 20+ hours/week
reclaimed) and a more urgent opening line. `npm run typecheck`, `npx vitest
run` (82 tests, unchanged — no new tests added, matching that
`buildEmailMessages`'s own rejection block was never unit-tested either,
only the classifier/word-count helpers are), and `npm run build` all pass.

**Bug found and fixed during this work: regenerating a blog draft silently
dropped its `meta.source_draft_id`** (the email→blog traceability link — see
[Blogs Section Separation] in memory). Root cause: `persistRegeneratedDraft`
INSERTs a brand-new draft row (`meta: meta ?? {}`), unlike `populateDraft`
which UPDATEs in place and merges with prior meta — so any meta field not
explicitly carried forward by the caller is lost on every regenerated
version, not just the first one. `regenerateBlogDraft` already carried
`hero_image` forward this way; it just didn't do the same for
`source_draft_id`. Fixed in `lib/pipeline/generate-blog.ts` by spreading
`draftCtx.meta.source_draft_id` into the new version's meta the same way
`hero_image` already was. Confirmed the bug was real by inspecting the DB
directly (an earlier, pre-fix test chain's v1 has `source_draft_id`, v2
doesn't), then live-verified the fix end to end with a fresh chain: created
a new blog off the same source email, rejected v1, and confirmed v2 both
kept `source_draft_id` in the DB and rendered the "From email: ..." back-link
in the UI.

**Code review (medium effort, 8 finder angles + verify pass) surfaced 2
non-blocking findings, no correctness bugs:** (1) `POST /api/drafts/[id]/reject`
now does a redundant `getDraftWithJobContext` fetch just to branch on job
type, then `regenerateBlogDraft`/`regenerateEmailDraft` immediately re-fetch
the same row internally — an extra DB round-trip per reject, not a
correctness issue. (2) The reject/regenerate UI state machine in
`blog-review-actions.tsx` is a near-verbatim copy of `review-actions.tsx`'s
existing email version — intentional (Phase A mirrors email by design), but
worth a shared hook/component if a third surface ever needs the same flow.
Both deferred, not fixed inline.

**Phase B (section-level copy editing) not started.** Per the 7-plan doc:
blog is Portable Text, not HTML, so email's find/replace-on-HTML model
doesn't fit — Phase B would edit the markdown source (`meta.blog_copy`) per
section via `prompts/adjust-copy.ts`, re-render via
`lib/blog/render-preview.ts`, keep `lib/blog/to-portable-text.ts` as the
publish-time conversion. Not attempted this session; check with Jordan
before starting since it's a distinct UI paradigm from Phase A.

**Test data left in place:** two throwaway blog draft chains for the topic
"Why Businesses Lose Leads" sitting alongside real content in Blogs — the
original (v1 rejected + v2 rejected + v3 in_review, from before the
source_draft_id fix, so v2/v3 lack the email back-link) and a fresh one from
verifying the fix (v1 rejected + v2 in_review, correctly linked back to the
source email). Cheap to archive/delete if Jordan wants the list tidy, left
as-is since both are real, usable draft content, not garbage.

## What's not built yet

- Settings-form UI to pick an email_type/blog_type override per topic/job
  (the backend override path is wired; nothing in the UI sets it yet) or to
  tune per-type word targets.
- Blog click-to-edit / section-level copy editing (Plan 5 Phase B) — blog
  reject/regenerate itself is done (Phase A, see above).
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

## Plan 6 — Recurring automation (done, live-verified, committed & pushed)

Started 2026-07-06, right after Plan 5 Phase A + the blog-copy-editing commit
(`b6f427d`) landed on `main`. Full plan lives at
`~/.claude/plans/noble-finding-duckling.md`.

Jordan's call locked in: dashboard badge only for notification, no new
Resend integration this cut.

**Everything in the plan is implemented, committed, and pushed to
`origin/main`** (`19bf24a` finishes the blog click-to-edit refactor,
`5d0a3ff` is Plan 6 itself):
- `db/migrations/010_content_schedules.sql` + mirrored into `db/schema.sql`.
- `lib/db/types.ts`: `Cadence`, `ContentSchedule`.
- `lib/scheduling/cadence.ts` + test: `computeNextRunAt`.
- `lib/db/queries.ts`: `createDraftShell`'s `triggerSource` param, plus the
  full schedule CRUD (`listContentSchedules`, `getContentSchedule`,
  `createContentSchedule`, `updateContentSchedule`, `deleteContentSchedule`,
  `getDueSchedules`, `markScheduleRun`, `getNextIdeaTopicId` — walks
  strategies→pillars→clusters→topics rather than a deep nested filter,
  `countScheduledAwaitingReview`).
- `lib/pipeline/run-schedule.ts`: `runDueSchedule` — picks the oldest idea
  topic, `createDraftShell` with `trigger_source: 'schedule'`, drives
  generation headlessly by wrapping `joinRun` in a promise (resolves on
  `done`, rejects on `error`), advances `next_run_at` via `computeNextRunAt`
  on success/skip, leaves it due on error so the next cron tick retries.
- `app/api/cron/run-schedules/route.ts`: `CRON_SECRET` bearer auth, 503 if
  unset, 401 if wrong, else runs all due schedules sequentially and returns
  `{processed, generated, skipped, failed}`.
- `app/api/schedules/route.ts` (GET/POST), `[id]/route.ts` (PATCH/DELETE),
  `[id]/run-now/route.ts` (POST) — behind the normal app session gate.
- `vercel.json` (daily cron, 13:00 UTC) + `CRON_SECRET` in `.env.example`
  and (a real generated value) in `.env.local`.
- Settings UI: new "Automation" `ListGroup` → "Recurring schedules" row →
  `SchedulesForm` (`app/(dashboard)/settings/_components/schedules-form.tsx`)
  in a `Sheet`, mirrors the Connections/Products pattern — list with
  Run now/Pause-Resume/Delete per row, plus a create form (channel, cadence,
  optional email/blog type override).
- Dashboard badge: `app/(dashboard)/page.tsx` shows "N scheduled drafts
  awaiting review → View" linking to `/emails` when
  `countScheduledAwaitingReview > 0`.

**Bug found and fixed during this work: the global auth middleware
(`lib/supabase/middleware.ts`) redirected every unauthenticated request to
`/login`, including `/api/cron/run-schedules`.** Vercel Cron hits that route
with a `CRON_SECRET` bearer token, not a browser session cookie — the
redirect would have fired before the route's own auth check ever ran, so the
real cron tick would silently never work in production (Vercel Cron sees a
307, not the intended 401/503/200). Fixed by adding `/api/cron` to
`PUBLIC_PATHS`; the route still fails closed on its own (503 unset, 401
wrong secret) so this doesn't weaken auth, it just lets the route's own gate
run at all. Live-verified via curl: wrong secret → 401, correct secret → 200
with a clean summary, `/api/schedules` (the human-facing CRUD) correctly
still redirects to `/login` without a session, confirming only the cron path
was exempted.

**Verified so far:** `npm run typecheck`, `npm run build` (all new routes
appear), `npx vitest run` (86 tests, unchanged — no new tests added, cadence
tests already existed from the earlier checkpoint) all pass. Live via
Playwright + curl: Settings → Automation → Recurring schedules sheet opens
and renders correctly (degrades to an empty list, matching the missing-table
guard); "Add schedule" against the not-yet-migrated DB fails with a toast,
not a crash; dashboard loads with no badge (count is genuinely 0); the cron
route's auth gate (503/401/200) confirmed live.

**Migration 010 applied 2026-07-06** (Jordan ran it in the Supabase SQL
editor); confirmed live via a direct REST query.

**Also found and fixed the same session: migration 003
(`archive_topics_drafts`) had silently never been applied to this live DB
either** (`topics.archived`/`drafts.archived` both 42703'd on a real query,
discovered because `getNextIdeaTopicId` filters on `topics.archived`, unlike
`listDrafts`'s read path which degrades gracefully). This meant the
already-shipped Archive/Unarchive buttons on the Emails/Blogs lists would
have 500'd if actually clicked, silently, this whole time. Jordan applied
migration 003 too; confirmed live.

**Full end-to-end live verification completed 2026-07-06** (real Claude
spend, not mocked): created a real schedule via Settings → Schedules, "Run
now" against a genuinely empty topic backlog correctly returned `skipped: no
topics available` and advanced `next_run_at` by one cadence interval; then
against a throwaway `idea`-status test topic, a real ~62s Claude generation
produced a draft with `content_jobs.trigger_source = 'schedule'` and
`state: in_review`, exactly as designed. Dashboard badge appeared while
in_review and disappeared immediately after Approve. All test artifacts
(the draft, the schedule, the test topic) were cleaned up afterward via the
app's own delete/archive flows, not raw DB deletes.

**Still open (not code, needs Jordan before shipping):**
1. Set `CRON_SECRET` (a real value is already in `.env.local`) as a Vercel
   project env var at/before deploy time, so the real daily cron tick
   authenticates in production.
2. Minor, non-blocking UX gap noticed during verification:
   `SchedulesForm`'s "Run now" doesn't update its row's last-run text until
   the page is reloaded (Pause/Resume and Delete do update immediately). Not
   fixed this session, cheap to pick up later.

## Logging & observability (app_logs) — done, committed (`dd73be5`), migration applied

Started in an earlier session that got cut off mid-build; picked back up and
finished the page this session. Every error/warning/info line across all
`app/api/**/route.ts` handlers, plus every Claude call's token usage, now
funnels through `lib/log.ts` (`logError`/`logWarn`/`logInfo`/`logTokenUsage`)
instead of bare `console.*` calls — console output is unchanged (kept
alongside), the addition is a persisted `app_logs` row (migration 011,
`db/migrations/011_app_logs.sql`, mirrored in `db/schema.sql`) so there's a
live feed instead of only server logs. One table, not two: `level`
(`info`/`warn`/`error`/`usage`) doubles as severity and as the usage-row
discriminator (usage-only columns — model, token counts, `estimated_usd` —
are null on plain log rows and vice versa), matching the jsonb-flex-plus-
typed-columns split already used for `drafts.meta`/`topics.keyword_data`.
`lib/db/table-guard.ts` extracts the shared `isMissingTableError` check
(PGRST205/42P01/"schema cache") that `queries.ts` already had duplicated for
products/brand_memory/generation_runs, so every not-yet-migrated table now
degrades identically. `lib/clients/model-ids.ts` pulls `DRAFT_MODEL`/
`FAST_MODEL` out of `lib/clients/anthropic.ts` (which now just re-exports
them) to break an import cycle (`cost.ts` needs the model constants for the
new `priceUsage` helper, `log.ts` needs `cost.ts` for pricing, `anthropic.ts`
needs `log.ts` for `logTokenUsage`). `instrumentation.ts` adds Next's
`onRequestError` hook as a belt-and-suspenders catch-all for anything outside
a route's own try/catch (middleware, layouts).

New this session: the actual `/logs` page (`app/(dashboard)/logs/page.tsx` +
`_components/logs-feed.tsx`), added to `NAV` (`_components/nav.tsx`, new
`ActivityIcon`) so it shows in both the sidebar and mobile tab bar. Server
component reads `listRecentLogs()` + `getLogStats()` (24h error/warn/usage
counts + estimated spend) for the first paint; `LogsFeed` is a client
component using the already-built `lib/use-logs-poll.ts` hook (2.5s poll,
`since`-cursor incremental fetch) with an All/Errors/Warnings/Usage
`SegmentedControl` filter. Usage rows show model + token breakdown +
`$estimated_usd`; other rows show the message and, if present, a collapsed
`context` JSON blob.

`npm run typecheck`, `npm run build` (both `/logs` and `/api/logs/recent`
appear in the route manifest), `npx vitest run` (86 tests, unchanged) all
pass. Confirmed live via curl against a local dev server: `/logs` and
`/api/logs/recent` both correctly 307-redirect to `/login` when
unauthenticated, matching every other dashboard route (no crash, auth gate
wired correctly).

**Migration 011 applied by Jordan 2026-07-06**; confirmed live via a direct
Supabase REST query (`app_logs` now returns 200, was `PGRST205` before).
Went further and exercised the actual write path end to end: ran `lib/log.ts`
directly against the live DB (via `npx tsx`, env vars sourced from
`.env.local`; needed a throwaway local `server-only` shim in `node_modules/`
since that package only resolves inside Next's own bundler, removed after),
calling real `logError`/`logTokenUsage`. Confirmed via REST that both an
`error`-level row (message + stack trace in `context`) and a `usage`-level
row (`model`, token counts, correctly computed `estimated_usd`) landed in
`app_logs` with the right shape, then deleted both test rows via REST so no
fake data sits in the real feed. This confirms the write path Jordan will
actually hit on every caught error and every Claude call is live and correct,
not just that the table exists. **Not yet verified: the `/logs` page's own
UI** (filter tabs switching, live polling picking up a new row within the
poll interval, stat tiles reflecting real data) — needs Jordan's own logged-in
session since there are no test credentials in this repo for a browser
click-through.

## Bug fix: create-chat never actually cleared after generating (2026-07-06)

Jordan reported the dashboard's create-agent chat kept resuming the same old
conversation on every login instead of starting fresh after a draft was
generated. Root cause: `getLatestActiveCampaign` (`lib/db/queries.ts`) resumes
any campaign whose `status` isn't `"done"`, but `lib/pipeline/generate.ts`
only ever advanced a campaign to `"drafted"` on completion, and
`lib/pipeline/generate-blog.ts` never touched campaign status at all — so
every campaign you ever finished stayed "active" forever. Fixed both to set
`status: "done"` once the draft actually finishes generating (email and
blog). Also patched the 3 existing live campaign rows stuck at `"drafted"`
to `"done"` directly via the Supabase REST API (one-time data fix, done with
Jordan's explicit go-ahead since it touches production data). One older
campaign is intentionally left at `"briefing"` (an unfinished brief, never
generated) — that will still resume on next login, which matches the
original intent of "pick up an incomplete brief where you left off."
`npm run typecheck` + `npx vitest run` (86 tests) pass. Not yet re-verified
live in the browser (no test credentials in this repo) — Jordan should
confirm the dashboard chat now starts blank after logging back in.

## Session 2026-07-06 (later): image control, cost guards, dashboard glow

- **Image prompt control:** subject toggle "AI sharpens it" vs "Use my words
  exactly" (exact mode skips the Haiku call entirely); every generated image
  now stores its final prompt (`ContentImage.prompt`), shown in the image
  sheet as an editable "Prompt behind the current image" with "Regenerate
  with this prompt" (sent verbatim via `exactPrompt`). Auto mode's scene-
  crafting prompt now treats a typed subject as a hard constraint (keep every
  named element). Addresses "the generator doesn't listen to my prompt."
- **Rate + cost guards:** new `lib/ai-guard.ts` — per-instance sliding-window
  rate limit (8/min generate, 6/min image) + optional global daily budget
  `DAILY_SPEND_LIMIT_USD` read from app_logs usage rows; wired into
  `/api/generate` and the image route's generate mode; degrades open.
  Anthropic client now `maxRetries: 4`; Gemini render gets one spaced retry
  on transient errors (429/503/network).
- **Dashboard glow:** new spectrum glow vocabulary in `globals.css`
  (`ring-spectrum`, `glow-spectrum`, `glow-spectrum-soft`, `aura-spectrum`);
  Home gets an ambient aura, ringed/lit create-agent card, softly lit stat
  tiles.
- **Docs:** `content-engine-rundown.html` updated for all of the above;
  new `multi-tenancy-roadmap.md` (concrete 6-step path to multi-user:
  brand_members → session-scoped brand resolution → RLS → per-brand budgets
  → unshared storage/creds — nothing blocks single-tenant production today).
- Gate: `npm run typecheck` + `npx vitest run` (86) + `npm run build` all
  pass. **Not yet verified in the browser:** the new image-sheet controls and
  the dashboard glow (needs Jordan's logged-in session or a Playwright MCP
  session).

## Next step (backlog, still open)

1. Click through `/logs` logged in as Jordan: confirm the stat tiles and feed
   render, the All/Errors/Warnings/Usage filter works, and a real
   error/generation shows up live within the ~2.5s poll interval.
2. Get real `DATAFORSEO_LOGIN`/`DATAFORSEO_PASSWORD` credentials from
   app.dataforseo.com (account email + a separate API password from their
   dashboard) and add them to `.env.local` — the only remaining blocker on
   Slice 4 keyword research now that migration 008 is confirmed applied.
3. Decide on Plan 5 Phase B (AI-assisted section-level copy editing for
   blogs, vs. the direct manual field editor already shipped in `b6f427d`)
   — check with Jordan before starting.
4. Remaining "Not yet verified" items: the from-scratch brand-guidelines
   generate path (no colors set), onboarding auto-images toggle, an actual
   MailerLite "Send now"/"Schedule" click-through (Jordan's call, not done
   yet — still testing), and Plan 4's actual cross-instance lock race test
   now that migration 009 is confirmed applied.

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
