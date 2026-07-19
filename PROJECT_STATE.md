# Project State

Living save/restore doc. Read this first to pick up context; update it
whenever progress, blockers, or decisions change. Keep this file short:
implementation detail (file paths, function names, "verified live" blow-by-
blow) belongs in git history and the code itself, not here. `git log
--oneline -20` is the changelog; this file is decisions + current state +
what's genuinely still open.

Last updated: 2026-07-18 (campaign per-product plans + email names — see
session below; also still open: **migrations 020 AND 021 need applying in the
Supabase SQL editor** — until 021 is applied, prompt capture silently no-ops
and /prompts stays empty; until 020, rating an email 500s).

## Session 2026-07-18 (later): campaign per-product plans + email names

Fix for a real failure: a chat-built product campaign ended in ONE
`generate_content` email instead of `plan_series` drafts. Verified with
`npm run typecheck` + `npm test` (407) + `npm run build`, all green.
**Not yet committed.**

- **Mechanical guard:** brief gained interview-state fields `campaign_kind` /
  `campaign_products` / `email_count`; while `campaign_kind` is set the chat
  route REFUSES `generate_content` (tool result tells the model to use
  `plan_series`, or clear with campaign_kind "single"). State is shown as a
  leading CAMPAIGN MODE line in BRIEF SO FAR and cleared after `plan_series`
  succeeds.
- **Kind-tailored campaign interview** (prompts/create-agent.ts): product
  campaigns ask which products + emails per product + the deal; promos ask
  deal/deadline/count with an urgency arc; newsletter runs ask themes;
  launches ask what/when. Plan proposal must list every email's name
  (subject), subheader, and angle, product campaigns exactly per-product
  count; user approves/edits names before `plan_series`.
- **User-picked name + subheader end to end:** new brief fields
  `subject_line`/`preheader` (update_brief + brief card "Name"/"Subheader"
  rows + single-email stage 13 THE NAME); `plan_series` items carry
  `subject`/`preheader` into each draft's `series_brief`;
  `buildCampaignBriefBlock` pins them (VERBATIM subject, near-verbatim
  preheader) so generation honors them. `plan_series` cap raised 10 → 12
  (3 per product x 4 products).

## Session 2026-07-18: intake grounding (fix "sounds like AI" copy)

Full plan at `~/.claude/plans/how-can-we-enhance-cheeky-pudding.md` (memory:
`project-intake-grounding-plan`), implemented in one session, all three steps.
`npm run typecheck` + `npm run build` + `npm test` (404 tests, up from 383)
all green. **Not yet committed.**

- **Step 1, grounding/enforcement (applies to every draft, even an empty
  brief):** `prompts/generate-email.ts`/`generate-blog.ts` RULES gained a
  "never invent numbers/stats/dates/prices/testimonials/names" bullet;
  COPY PRINCIPLES' unqualified specificity demand was softened to stop
  compelling fabrication. QA (`prompts/qa-email.ts`) now takes the brief and
  checks copy against a GROUNDING FACTS block (brief proof/offer terms +
  product price/deliverables); `QaSchema`/`QA_TOOL` gained
  `unsupported_specifics[]` / `proof_used` / `offer_terms_accurate`,
  `unsupported_specifics.length` folds into `qa_pass` and `issues`. Surfaced
  as a "Couldn't verify" list in both `review-actions.tsx` and
  `blog-review-actions.tsx` (blog has no model QA, so it just never fires
  there). `rewriteRegion`/`buildRewriteMessages` now load the campaign brief
  and treat its proof/offer facts as authoritative (keep verbatim, don't
  paraphrase into vagueness).
- **Step 2, reconciled naming:** `angle` no longer described as "the hook" in
  `prompts/campaign.ts`/`agent-tools.ts` (it's the editorial lens; `hook` is
  the new, distinct "how it opens" field). `buildOfferBlock` now takes
  `(ctx, brief)` and is the ONE offer section (brief `offer_*` fields win,
  product row fills gaps); no competing offer block was added to
  `buildCampaignBriefBlock`.
- **Step 3, new fields:** `CampaignBrief` +7 (`proof`, `hook`, `offer_deal`,
  `offer_deadline`, `offer_price`, `offer_exclusions`, `reader_belief`) plus a
  new `CAMPAIGN_BRIEF_TEXT_FIELDS` const (`lib/db/types.ts`) iterated at every
  allowlist site instead of a hand-copied array, with a compile-time
  drift-guard test (`lib/db/types.test.ts`) that fails typecheck if a future
  plain-text field is added without updating the const. All seven
  allowlist/plumbing sites fixed: chat `mergeBrief`, the "saved" echo list,
  `seriesBrief` (also fixed the pre-existing `email_style`/`image_style` drop
  on every series), `flyerBrief`, `AUTO_MODE_LINES`, the campaign form +
  `/api/campaigns/start`, and the brief card. `PlanSeriesItem`/`PLAN_SERIES_TOOL`
  gained per-email `proof`/`offer_deadline` overrides. `resolveEmailType` folds
  `offer_deadline` into promo detection (still requires `offer_slug`).
  `regenerateBlogDraft` now reads `meta.series_brief` first, matching its email
  twin (was silently ignoring per-email series briefs on every blog reject).
  **Deleted `app/api/campaigns/chat/route.ts`** (confirmed dead: no
  `fetch("/api/campaigns/chat")` anywhere, already drifted from the real
  create-chat route). Create-agent chat stages renumbered/added: general flow
  gained PROOF (stage 5) and READER BELIEF (stage 8); product flow's "p2. THE
  HOOK" now actually saves `hook` (plus `key_message`, since for a short
  product email they're the same content) instead of misrouting to
  `key_message` alone; "p3. THE OFFER" now parses one answer onto
  `offer_deal`/`offer_deadline`/`offer_price`/`offer_exclusions` instead of
  dumping into `angle`/`constraints`; campaign series flow (c1-c12) got the
  same PROOF/READER BELIEF additions. Campaign form gained a "Got a real
  number or result?" field and a conditional "What's the deal?" section
  (deal/deadline/price/exclusions, shown for sales/signups/product goals,
  cleared via `useEffect` when it hides). Brief card round-trip fixed two
  pre-existing bugs while adding proof/hook/angle/reader-belief/offer-summary
  rows: the `Vibe` row rendered but was absent from `onApply` (edits silently
  discarded), and `keyMessage`/`angle` had no editable row at all.
- **Verification still open (not code, needs Jordan or a follow-up session):**
  browser click-through (Playwright MCP is off by default per this repo's
  CLAUDE.md); reading `/prompts` to confirm the assembled PROOF/HOOK/OFFER
  blocks render as expected is blocked on migration 021 (see
  [[project-prompt-capture]]); a 3-email `plan_series` run to confirm
  per-item proof/offer_deadline overrides and that `email_style`/`image_style`
  now survive a series.

## Session 2026-07-15 (latest): email editor sweep

- Fixed the "some words aren't editable" bug at the root: copy the model (or
  the code templates' lead/`<h2>` blocks) left outside any `data-region` is
  now auto-tagged as an editable body region — at generation, on every edit,
  and write-through when an old draft's review page opens.
- Header has its own edit mode: selecting it offers only "Align logo"
  (left/center/right, applied to the cell that actually moves the logo);
  no more free-typing over the logo, no Rewrite.
- Footer redesigned (new generations): wordmark, domain·email line, circular
  social badges pulled from Settings' social links (typographic glyphs, no
  external images), postal address, permission line, unsubscribe. Same spec
  mirrored into the model design brief.
- Editor polish: Design panel follows page scroll; color swatches seed from
  the section's real rendered color.
- typecheck/build/339 tests green; UNCOMMITTED (kept separate from the
  prompt-capture session's uncommitted files); browser click-through pending.
  Step plan: `~/.claude/plans/wondrous-cuddling-yeti.md`.

## Session 2026-07-15 (later): prompt capture + /prompts admin page

- Every AI request the app sends is now captured in full (migration 021:
  `prompt_logs`) so Jordan can read exactly how context/prompts are assembled
  and tune them. Capture happens at the HTTP layer: a custom `fetch` on the
  one Anthropic client (`lib/clients/prompt-capture.ts`, hooked in
  `lib/clients/anthropic.ts`) covers all ~19 call sites, plus an explicit
  capture in `lib/clients/gemini-image.ts` for image prompts.
- Base64 payloads are stripped to size placeholders; prompt TEXT is never
  truncated. SDK retry duplicates are deduped; rows self-prune after 30 days.
- Admin-only `/prompts` list + `/prompts/[id]` detail page (system prompt with
  cache breakpoints, messages by role, tools collapsed) mirroring the /logs
  gating. Unit tests in `lib/clients/prompt-capture.test.ts`.
- Not yet browser-verified live (needs migration 021 applied + a real
  generation + an admin login).

## Session 2026-07-15: thumbs feedback loop, product email rework, deeper chat interview

- Chat interview deepened (pushed `5b5a118`, `8414ebd`): every stage asked
  (tone is its own question), campaigns get the full question set (count,
  images, tone, length...), landing Blog tile → Image (standalone social
  flyer via `generate_content` channel `social`), topic question is now
  open-ended (no past-topic chips).
- Thumbs up/down on the email review screen (migration 020: `drafts.feedback`).
  Judgment-only, never touches draft state. Recent rated emails (3 per side)
  are injected into the generation prompt as liked/disliked taste examples
  (`listFeedbackEmailExamples` → `buildFeedbackBlock`), fresh + regenerate
  paths both.
- Product emails reworked: exactly ONE paragraph (words 80-160, sections
  [1,1]) with creative-agency energy (fun, witty, never formal) via
  `EMAIL_LENGTH_TARGETS.product`; the chat's tone question leads product
  emails with "Fun and witty".

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
- **User roles (new, migration 013, not yet applied to the live DB):**
  `user_profiles` table (`id` → `auth.users`, `role` in `admin`/`user`,
  default `user`) plus an `on_auth_user_created_profile` trigger so future
  invited users default to `user`; the migration's one-time backfill makes
  every *existing* auth user (today just Jordan) `admin` so nobody gets
  locked out by applying it. First (and so far only) use: the Logs nav item
  (`app/(dashboard)/_components/nav.tsx` `adminOnly` flag) is hidden from
  non-admins in the sidebar and tab bar, and both the `/logs` page and
  `/api/logs/recent` independently re-check the role server-side (404, not
  redirect, so the route's existence isn't signaled). `getUserRole()` in
  `lib/db/queries.ts` fails closed to `'user'` if the table isn't migrated
  yet or the row is missing. This is a flat, non-brand-scoped role — see
  `multi-tenancy-roadmap.md` for how it's expected to grow into per-brand
  roles (`owner`/`editor`/`viewer`) later; that roadmap's `brand_members`
  table is unrelated to this one and not built yet.

## Session 2026-07-13: style context — reference emails, length control, chat style examples

Jordan's feedback after the print-product campaign: emails came out too wordy
and off-voice, and there was no way to hand the engine an example email to
match. Three features shipped together (typecheck + 194 tests + build green;
uncommitted; **migration 015 not yet applied**):

1. **Reference email library** (`db/migrations/015_reference_emails.sql`,
   `reference_emails` table). Settings → "Reference emails": paste or upload
   (.txt/.md/.html/.eml) a full email you want yours to read like. On save,
   `lib/pipeline/extract-style.ts` runs ONE Claude call (DRAFT_MODEL, forced
   `save_style_profile` tool) distilling summary/traits/approx_words into
   `style_profile` jsonb; extraction failure still saves the raw email
   (non-fatal by design). `getTopicContext` now loads the library
   (missing-table degrades to empty), and `buildReferenceEmailsBlock`
   (prompts/brand-voice.ts) injects all rows' traits + the 2 newest raw
   emails (2500 chars each) into every email generation's system prompt,
   with "references outrank the voice description for style". API:
   `/api/reference-emails` (GET/POST, maxDuration 60) + `[id]` DELETE.
2. **Email length preference** (`voice_profile.email_length`:
   short/standard/long, no migration needed). Settings → Voice → segmented
   control. `resolveLengthTarget` (prompts/generate-email.ts) scales the
   per-type word budgets (~55% for short, 130% for long, 50-word floor;
   short also drops one section off the ceiling) and appends the why to the
   directive. `buildEmailMessages` now RETURNS `lengthTarget`; both
   generate.ts callsites (fresh + regenerate) and the QA length check use
   it, so prompt, too-short retry, and QA all agree. Key context: the old
   system only enforced a MINIMUM (retry-if-short), which is why emails ran
   long.
3. **Per-piece style example in chat** (`brief.style_example`). The create
   agent's stage 4 is now TONE AND STYLE: it invites pasting a whole email
   ("theirs or anyone's") and saves it VERBATIM via
   `update_brief.style_example` (new tool field; both create + campaign
   routes' `mergeBrief` flatten HTML via `emailHtmlToText` in lib/text.ts,
   cap 8000 chars, and deliberately DON'T strip em-dashes, it's the user's
   own reference). `buildCampaignBriefBlock` injects it (3000-char cap) with
   match-style-never-content instructions; `plan_series` carries it into
   every `series_brief`. Brief-state block shows presence only (token
   thrift). ComposerBar grew a paperclip attach (new `PaperclipIcon`):
   reads the file client-side, flattens HTML via DOMParser, drops it into
   the input prefixed "Here's an example email I want mine to read like".

Still open from this session:
- **Apply `db/migrations/015_reference_emails.sql`** in the Supabase SQL
  editor (app degrades gracefully until then: empty library).
- Live click-through: add a reference email in Settings (watch the
  "Analyzing style…" save), set length to Short, generate an email, confirm
  it's tighter and echoes the reference's rhythm; paste an example email in
  the create chat and confirm the agent saves it as style_example (brief
  tool result says "attached").
- Brief card UI doesn't show/clear style_example (model-side only); add a
  row later if Jordan wants to see/remove it per piece.

(That batch is now COMMITTED as `fdc5a34 new chat features`.)

## Session 2026-07-13 (later): non-technical guided chat, email design refs, universal uploads, plain formatting

Driver: Jordan is technical, his END USERS are not. The create chat asked
compound, jargon-y questions and answered in `**markdown**` that rendered as
literal asterisks. He also wanted to hand the engine ANY style material
(text, HTML, code, a file, a screenshot) and, for images specifically, get a
true recreation of the design, not loose inspiration. A raw Gmail "show
original" paste (MIME + quoted-printable) was being rejected outright.

Five parts, all on top of `fdc5a34` (typecheck + **211 tests** + build green;
pushed as `60bedf4` + `9edb3e2`; **migrations 015 and 016 both applied and
verified live on 2026-07-14**):

1. **Chip-first wizard** (`prompts/create-agent.ts`, mirrored into
   `prompts/campaign.ts`). Rules the prompt now states absolutely: ONE short
   question per turn, ALWAYS paired with `suggest_options` chips, plain
   everyday words, never an internal concept (brief/tool/field/CTA/funnel/ICP),
   chips never block free typing. Stages: what they're making → kind of email
   (chips map to the `email_type` enum) → topic → the one message → what
   readers should do (chips from the CTA library + mapped product) → who it's
   for → length → image → look and feel → recap + generate.
   Front-loading still short-circuits the whole thing.
   Key mechanic worth knowing: a tapped chip is just `send(opt.label)`, i.e. a
   normal user message. `opt.id`/`kind` never reach the server, so chips needed
   NO new UI channel.
2. **Per-piece brief fields** `length` and `include_image` on `CampaignBrief` /
   `UpdateBriefInput` / both routes' `mergeBrief` / `buildBriefStateBlock`.
   `buildEmailMessages` resolves `opts.brief?.length ?? brand.voice_profile
   .email_length`, so the chat's choice beats the brand default.
   `maybeAutoHeroImage` grew a `force` flag: `include_image === true` beats the
   brand's `auto === false` opt-out, `false` skips, unset keeps the old
   behavior. `skip` (series) still wins over `force`.
3. **New `create_flyer_from_email` tool** (`prompts/agent-tools.ts` + a
   `dispatchTool` case in `/api/create/chat`), mirroring
   `create_blog_from_email` including its reuse-don't-duplicate check
   (`getFlyerDraftFromEmail`, which already existed). Creates a `social` shell
   with `meta.source_draft_id`, which the flyer pipeline already consumes.
   **Deviation from the plan, on purpose:** the plan wanted a "want a matching
   flyer?" chip question right after the draft is generated. That is
   unreachable: `create-agent.tsx` does `router.push('/drafts/'+draftId)` the
   moment `generate_content` returns, so the user is never looking at the chat
   when that question renders. The draft review page ALREADY has a Create flyer
   button (`review-actions.tsx` → `/api/drafts/[id]/create-flyer`), which is
   the right place. So the prompt now just points there, and the tool serves the
   in-chat path that DOES work: "make a flyer out of that email".
4. **Email design references** (`db/migrations/016_email_design_references.sql`).
   REUSES the migration-014 `style_references` table and bucket rather than a
   parallel one; three new columns tell the two libraries apart: `kind`
   ('flyer' default | 'email'), `mode` ('style' | 'recreate'), `design_profile`
   jsonb. Upload a screenshot in Settings → "Email designs" (or just attach it
   in chat) → `/api/style-references` with `kind=email` runs ONE vision call
   (`lib/pipeline/extract-design.ts`, forced `save_design_profile`, null on
   failure) → every email generation attaches the ACTUAL image to the user turn
   (`loadEmailDesignReference` in generate.ts, non-fatal) and injects
   `buildDesignReferenceBlock` (prompts/email-design.ts) telling the model to
   RECREATE the layout with this brand's colors/fonts/copy. Only the NEWEST
   email-kind ref is used (blending two would recreate neither). The design
   system's hard rules (600px card, inline styles, dark mode, `{$unsubscribe}`)
   explicitly WIN over the reference. `generateEmailCopy`'s user message becomes
   `[image, text]` blocks via a `toUserContent` helper shared by the first call
   AND both retries, so a retry never silently drops the image; the system
   prompt stays a cacheable string.
   New `isMissingColumnError` (lib/db/table-guard.ts) lets
   `listStyleReferences(brandId, kind)` degrade on a pre-016 DB instead of
   crashing; `createStyleReference` omits the new columns unless passed.
5. **Universal chat uploads + raw MIME + no markdown.** The composer paperclip
   now branches: an IMAGE posts straight to `/api/style-references` as
   `kind=email` (design library); anything else rides into the composer as text.
   Client-side DOMParser flattening was REMOVED on purpose, it shredded MIME;
   the raw text now goes to the server, where `emailHtmlToText` (lib/text.ts)
   unwraps RFC-822/MIME first (boundary split, prefers text/html, decodes
   quoted-printable to BYTES so emoji survive, decodes base64, strips headers)
   and only then flattens HTML. The 8000-char cap still applies AFTER
   extraction, in `mergeBrief`. New `stripMarkdown` (lib/text.ts) is applied to
   both chat routes' replies, `renderEmailForContext`'s copy fields, and
   `cleanFlyerCopy` — never to email HTML, where `**`/`#` are legal.

Still open from this session:
- ~~Apply migrations 015 + 016~~ **BOTH CONFIRMED APPLIED 2026-07-14** (checked
  against the live DB, not assumed): `reference_emails` exists;
  `style_references` has `kind`/`mode`/`design_profile`; the pre-existing flyer
  row correctly backfilled to `kind=flyer, mode=style`; the `kind` check
  constraint is enforced (rejects a bogus value with 23514). Both libraries are
  currently EMPTY, so uploading the first email design is what proves the
  feature end to end.
- Committed and pushed: `60bedf4` (the batch) + `9edb3e2` (click-through fixes).
- Live click-through (the whole point, none of it is browser-verified):
  tap through the new chip flow start to finish and confirm every question is
  one line with chips; upload a screenshot in chat and confirm the generated
  email actually copies that design; paste a raw Gmail "show original" and
  confirm it's accepted, not refused; confirm no asterisks in any reply; and in
  chat say "make a flyer out of that email" about an existing email, confirming
  a flyer draft opens.
- Known cost, accepted: an attached text/.eml file rides into the chat message
  at up to 100k chars and is persisted in the transcript, so it's re-sent (from
  the prompt cache) on later turns. The stored `style_example` is still capped
  at 8000 chars after extraction. Tighten the composer cap if it ever bites.

## Session 2026-07-14: billing slices 5 and 6 (subscriptions + billing UI)

Full plan at `~/.claude/plans/i-m-going-to-be-lazy-cocke.md`. Slices 1 to 4
(multi-tenancy, credit ledger, paywall, Stripe Checkout for packs) were
already committed and pushed (`7767194`, `87c5971`, `06122ec`). This session
built the remaining two slices, uncommitted at time of writing:

- **Slice 5, subscriptions + monthly allowance cron:**
  `app/api/billing/checkout/route.ts` now takes `{plan:"pro"}` alongside
  `{packId}` and creates a subscription-mode Checkout Session against
  `STRIPE_PRO_PRICE_ID` (new env var, not yet set locally, no Stripe account
  exists yet). `app/api/stripe/webhook/route.ts` gained
  `customer.subscription.updated`/`.deleted` and `invoice.paid` handlers plus
  the subscription branch of `checkout.session.completed`; all four are
  live-verified only via the mocked webhook test suite (11 tests,
  `route.test.ts` rewritten), never against a real Stripe event, since there
  is still no Stripe account. One real gotcha found and worked around: this
  Stripe SDK version (22.3.1, a newer "flexible billing" API) has **no
  top-level `current_period_end` on `Subscription`** (it moved to
  `subscription.items.data[0].current_period_end`) and **no top-level
  `subscription` on `Invoice`** (it moved to
  `invoice.parent.subscription_details.subscription`) — both handled via
  small helpers (`subscriptionPeriodEnd`, the `parent.subscription_details`
  read in `handleInvoicePaid`). New `app/api/cron/grant-allowances/route.ts`
  (CRON_SECRET bearer, same fail-closed pattern as `run-schedules`) walks
  every brand via new `lib/db/queries.ts` helpers
  (`listBrandsForAllowance`, `markAllowanceGranted`,
  `getBrandBillingByCustomerId`) and grants the free or paid monthly
  allowance, idempotent on `allowance:{brandId}:{period}`. New cron entry in
  `vercel.json` (06:00 UTC daily, separate from `run-schedules`' 13:00 UTC).
  **Live-verified against the real Supabase DB** (not just unit tests): ran
  the cron via curl with the real `CRON_SECRET` twice, first run granted
  1000 free credits to the one real brand (Moguls) and stamped
  `last_allowance_period = "2026-07"`, second run in the same period
  correctly granted 0 and skipped 1, confirming idempotency live.

- **Slice 6, billing UI:** `/billing` already had a shell from slice 4
  (balance, buy-credits, a bare "Manage subscription" button); this session
  added an "Upgrade to Pro" button (only when `STRIPE_PRO_PRICE_ID` is set),
  a usage-this-month bar chart grouping `app_logs` usage rows by action type
  (new `lib/billing/usage-labels.ts`, pure + unit-tested: `bucketUsage` maps
  raw `source` strings like `email-copy`/`redesign`/`flyer-image` to human
  categories, caps to 6 rows + "Other"), and a transaction history table
  reading straight off `credit_transactions` (new `getUsageBreakdown` /
  `listCreditTransactions` in `queries.ts`). The usage chart follows the
  dataviz skill: single-hue horizontal bars (the existing brand `--cyan`
  token), 4px rounded data-ends, direct labels (name + $ at the tip), no
  legend needed since it's one series — chosen over a categorical palette
  because this app's existing 4-hue brand palette (amber/magenta/violet/cyan)
  **fails** `validate_palette.js`'s lightness-band check in both light and
  dark mode, and a single-hue magnitude bar sidesteps that requirement
  entirely rather than shipping a chart that fails its own accessibility
  gate. **Live-verified against the real DB** via a throwaway `tsx` script:
  `getUsageBreakdown` correctly returned the one real "redesign" usage row
  ($0.0144), `listCreditTransactions` returned the real 3-row ledger (starter
  2000, usage -3, and the allowance +1000 granted above) in the right shape.
  Settings' "Plan & billing" row already existed (shipped with slice 4),
  nothing to add there.

  Also wired the **out-of-credits paywall CTA** everywhere a metered call can
  429 with `outOfCredits`, per the plan's slice-6 scope: new
  `lib/billing/toast-error.ts` (`ApiError` class carries `outOfCredits`/
  `upgradeUrl` through a throw/catch; `toastApiError` shows a "Buy credits"
  toast action; `components/ui/toast.tsx` gained an optional `action{label,
  href}` on error toasts, 8s duration instead of 4s so there's time to click).
  Wired into: `generate-button.tsx`, `quick-generate.tsx`, `create-agent.tsx`
  (both the direct `/api/generate` path and the `generate-stream` SSE path
  via `use-generation-stream.ts` + `generation-progress.tsx`, which is the
  main "generating..." screen most drafts actually go through),
  `review-actions.tsx`/`blog-review-actions.tsx`/`flyer-review-actions.tsx`
  (reject/regenerate, create-blog, create-flyer, image regenerate),
  `image-sheet.tsx`, `design-chat.tsx` (adjust-style, redesign),
  `email-preview.tsx` (image regenerate), `new-flyer-form.tsx`, and — the
  highest-value one — `rewrite-modal.tsx` + `editable-adapter.ts`'s shared
  `sendJson` (the one chokepoint both the email and blog inline-editor
  adapters funnel every save/rewrite through), so the AI Rewrite propose
  step shows the CTA correctly without touching either adapter file directly.

  `npm run typecheck` + `npx vitest run` (**285 tests**, up from 278) +
  `npm run build` all pass. Not committed yet.

**Still open (needs Jordan, not code):**
1. **No Stripe account exists yet** (same blocker as slice 4's session) — the
   whole subscription path (checkout, webhook, Customer Portal) is
   type-correct and unit-tested but has never touched a real Stripe API call.
   Needs: a Stripe account, one recurring Price for Pro
   (`STRIPE_PRO_PRICE_ID`), N one-time Prices for packs
   (`billing_config.packs`), `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` in
   `.env.local`, then `stripe listen --forward-to
   localhost:3000/api/stripe/webhook` + `stripe trigger` to exercise the
   webhook handlers for real (`checkout.session.completed` both modes,
   `customer.subscription.updated`/`.deleted`, `invoice.paid`) — the mocked
   test suite proves the routing logic, not the real signature/shape
   round-trip.
2. **`vercel.json`'s new cron entry needs a deploy** to actually fire in
   production (same as `run-schedules` before it); `CRON_SECRET` is already
   a real value in `.env.local` and just needs to be a Vercel project env var
   too (per the still-open item from the automation session).
3. **Browser click-through of `/billing`'s new UI** (usage chart rendering
   with more than one category, the transaction table, the Upgrade to Pro
   button's redirect, light + dark) — not done this session; the auth hatch
   is locked (multi-tenancy slice 1), so there's no login-free path to it
   anymore, needs Jordan's own session.
4. Decide the real `billing_config.packs` and Pro plan pricing before this
   goes live — today `packs` is `[]` (empty) and `STRIPE_PRO_PRICE_ID` is
   unset, so both the pack grid and the Upgrade button show their
   "not configured yet" states rather than anything purchasable.

## Next step (backlog, still open)

1. Apply `db/migrations/013_user_roles.sql` in the Supabase SQL editor, then
   verify: Jordan's own account still sees Logs (backfilled to `admin`), and
   a second test account (or `update user_profiles set role = 'user'` on a
   throwaway row) confirms Logs disappears from both the sidebar and tab bar
   and `/logs` / `/api/logs/recent` 404 directly.
2. Click through `/logs` logged in as Jordan: confirm the stat tiles and feed
   render, the All/Errors/Warnings/Usage filter works, and a real
   error/generation shows up live within the ~2.5s poll interval.
3. Get real `DATAFORSEO_LOGIN`/`DATAFORSEO_PASSWORD` credentials from
   app.dataforseo.com (account email + a separate API password from their
   dashboard) and add them to `.env.local` — the only remaining blocker on
   Slice 4 keyword research now that migration 008 is confirmed applied.
4. Decide on Plan 5 Phase B (AI-assisted section-level copy editing for
   blogs, vs. the direct manual field editor already shipped in `b6f427d`)
   — check with Jordan before starting.
5. Remaining "Not yet verified" items: the from-scratch brand-guidelines
   generate path (no colors set), onboarding auto-images toggle, an actual
   MailerLite "Send now"/"Schedule" click-through (Jordan's call, not done
   yet — still testing), and Plan 4's actual cross-instance lock race test
   now that migration 009 is confirmed applied.

## Session 2026-07-14 (late): editor bug sweep (uncommitted)

Six reported editor bugs fixed in one pass; typecheck + build + all 299
Vitest tests green. Browser click-through still pending (needs a real login).

1. Dark-mode black text: new `lib/email/dark-mode.ts`
   (`ensureDarkModeReadability`, unit-tested) mechanically repairs model
   emails whose dark-mode CSS misses elements — dark inline colors get a
   generated class + appended dark-media rule (hue-preserving lighten).
   Runs at fresh generation and inside `commitHtmlEdit`, so old drafts heal
   on their next edit.
2. Email preview now opens locked to Light (was "auto" = followed system).
3. Section selection: floating toolbar no longer steals clicks from the
   section below it (pointer-events pass-through except its buttons), is
   clamped inside the preview, ring offset tightened, and near-miss clicks
   (≤14px) snap to the closest section.
4. CTA buttons are directly editable without AI: link clicks in the preview
   no longer navigate the iframe away, and the Design panel now styles the
   inner `<a>` (color/fill/size/weight) instead of the wrapper
   (`applyCtaStyleChanges`, unit-tested). Follow-up in the same session: the
   button is now FORM-edited, never contentEditable (select-all-delete used
   to remove the `<a>` itself and the button vanished). Second click opens
   the Design panel, which gained a "Button text" field; the label travels
   as plain text to `/style-edit` (`buttonText` → `replaceCtaText`,
   unit-tested), so the anchor markup can't be damaged or have its styling
   stripped by the contentEditable sanitizer. Selection is also re-bound to
   the fresh iframe document after every save, so chained applies
   (color → text) no longer read stale markup.
5. Clicking the email image opens the image sheet directly
   (`activatableMarkers` on InlinePreview).
6. PNG uploads with transparency stay PNG end to end (optimize → storage
   contentType/extension → Sanity publish); opaque images still JPEG.

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
