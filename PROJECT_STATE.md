# Project State

Living save/restore doc. Read this first to pick up context; update it
whenever progress, blockers, or decisions change.

Last updated: 2026-07-03 (evening: email-creation slice built).

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
  ahead of the current slice — though see "beyond the slice plan" below,
  which was explicitly scoped as a UI/infra pass rather than a content slice.
- **Publishing is deferred by Jordan's call (2026-07-03):** no MailerLite,
  Sanity push, or social APIs until the content itself looks exactly right.
  Roadmap is creation-first: email look/feel → blog creation → images →
  social drafts → publishing layer → multi-tenant SaaS.
- AI proposes, the human approves: brand-brain writes only happen on an
  explicit Save/confirm (settings suggest, campaign-chat voice proposals,
  guidelines synthesis all follow this contract).

## What's done

- **Slice 0 — Scaffold:** `db/schema.sql`, `db/seed.ts`, dashboard topic list, `lib/db/*`.
- **Slice 1 — Generate email:** `POST /api/generate` → `generateEmailForTopic()`
  → Claude structured output (`messages.parse` + `zodOutputFormat`) → persisted
  as `drafts` v1 + `content_jobs`, topic marked `in_progress`.
- **Slice 2 — Review gate:** approve / edit / reject-with-feedback → regenerate
  (capped at 3 regenerations), `app/(dashboard)/drafts/[id]`.
- **Supabase project live**, schema applied, brand strategy seeded (12 topics).
- **UI-REDESIGN-PLAN.md — implemented in full** (commit "new ui"):
  - Supabase Auth (`middleware.ts`, `lib/supabase/{client,server,middleware,actions,config}.ts`,
    `app/(auth)/login/`, `app/auth/callback/`).
  - Native-app dashboard shell: `app/(dashboard)/layout.tsx` + `_components/`
    (tab bar / sidebar, large titles, top bar).
  - Mogul "Bold spectrum" dark brand system wired into `app/globals.css`
    (Ink/Carbon neutrals, spectral gradient tokens, Clash Grotesk + Hanken
    Grotesk fonts).
  - Native UI kit in `components/ui/` (Button, Card, Sheet, ListRow, Field,
    Badge, Segmented, StatCard, Spinner, etc.).
  - Home tab content assistant: `app/(dashboard)/_components/assistant.tsx`
    + `app/api/assistant/chat/route.ts` + `prompts/assistant.ts`, with a
    `generate_email` tool that calls the existing pipeline.
  - Onboarding chat flow (`/onboarding`, `app/api/onboarding/chat`,
    `prompts/onboarding.ts`) for first-run brand strategy setup.
  - Settings: grouped forms (brand basics, brand voice, positioning, visual
    identity/logo, ICP, funnel) each with a non-persisting "✨ Suggest with
    AI" assist (`app/api/settings/*`, `prompts/suggest.ts`).
  - Emails tab: flat cross-topic draft list via `listDrafts()` in
    `lib/db/queries.ts`.
- **Import from website (2026-07-03):** `lib/scrape/` (SSRF-guarded fetch,
  homepage + up to 7 high-signal pages, deterministic color/font/logo signal
  extraction) → `prompts/import-website.ts` (one forced tool call) →
  `POST /api/settings/import-website` returns a `BrandImportProposal`, zero
  DB writes. Shared review UI `app/(dashboard)/_components/import-review.tsx`
  (used by Settings → "Import from website" and the onboarding
  create-brand form) saves selected sections through the EXISTING settings
  PATCH routes, merged over stored values. Colors/logo are validated against
  the code-extracted candidates (anti-hallucination); scraped logos are
  mirrored into the `logos` bucket. JS-rendered sites (like
  moguldesignagency.com itself) are handled by a headless-Chrome fallback
  (`lib/scrape/render.ts`, puppeteer-core driving the locally installed
  Chrome): plain fetch stays the fast path, rendering kicks in only when the
  homepage HTML has almost no text. On serverless hosting set
  CHROME_EXECUTABLE_PATH (e.g. @sparticuz/chromium) or rendering quietly
  degrades to plain fetch. Known limit: oklch()-only sites yield no color
  candidates (hex, rgb(), hsl() are parsed).

- **Fresh-user flow fixes (2026-07-03):** a brand-new brand can now actually
  generate. (1) `ensureDefaultCluster` in `lib/db/queries.ts` creates a
  starter pillar ("Core content") + cluster ("Starter ideas") when none
  exist; `ensureStrategyAndPrimaryIcp` calls it, and the campaign chat's
  `create_topic` uses it instead of silently dropping topics. (2) Onboarding
  completion now hands off to "Generate your first email" (/campaigns/new)
  instead of the dashboard. (3) The Create tab leads with the campaign
  conversation ("What do you want to send?"), the topic tree is renamed
  "Content plan" with an empty state, and `/api/topics/suggest` (POST
  proposes, PUT saves picked) + `SuggestTopics` component generate starter
  topic ideas from the brand brain (verified live: 8 on-brand ideas mapped
  to real product slugs).
- **Campaign chat + reject/regenerate fixes (2026-07-03, from Jordan's
  walkthrough transcript):**
  1. `app/api/campaigns/chat/route.ts` had two distinct stall bugs. (a) A
     bare tool-call turn (no text block) fell back to generic filler
     ("Got it, let's keep going."); now, when the reply is empty, a
     text-only follow-up call (`tool_choice: "none"`) gets a real
     conversational line instead. (b) Worse: once the brief was already
     complete, the model sometimes narrated action ("Let me kick this off
     now.", "Let me save everything...") turn after turn WITHOUT ever
     calling `start_generation`, an infinite loop the transcript showed
     happening 5+ times in a row, requiring the user to keep saying "Ok".
     Fixed by snapshotting `briefWasReady` before the turn (goal +
     key_message + topic_id all already set); if the model's turn calls NO
     tool at all in that state, a forced retry with `tool_choice: "any"`
     guarantees real action (verified: forces `start_generation` reliably
     in this context). Tool-effect logic was factored into
     `applyContentBlocks()` so both the primary turn and the forced retry
     share one code path (no double-application risk, since the retry only
     fires when the primary turn called zero tools).
  2. Reject & regenerate is no longer a blocking modal: `review-actions.tsx`
     closes the reject Sheet the instant feedback is submitted (previously
     it stayed open, undismissable in practice, for the full 30-90s+
     generation). A non-blocking status card ("Writing and designing in the
     background... feel free to leave this page") shows on the draft page;
     when done, "New version ready → View" appears (or an error). The
     reject feedback field's copy now explicitly invites style/design
     requests (colors, whitespace, tone), not just content edits, since the
     model designs the full HTML from scratch each regeneration and this
     free-text channel already reaches that design prompt. Added a
     "Layout" selector (Keep layout / Quick tip / Feature / Step-by-step)
     that overrides the topic's auto-resolved template shape for just that
     regeneration (`regenerateEmailDraft(draftId, feedback, { templateOverride })`
     in `lib/pipeline/generate.ts`, threaded through `buildEmailMessages`).
  - **Known limitation, not built:** regeneration still runs synchronously
    server-side inside the request (up to `maxDuration: 300`); if the user
    navigates away before it resolves, the new draft still gets created
    (server-side work isn't cancelled), but there's no cross-page
    notification, they'd discover it via the Emails tab. A real background
    job queue / global toast system would close that gap; out of scope for
    this pass.
- **Brand identity generator (2026-07-03):** brands with no website to
  import from used to leave `visual_identity` empty (silent fallback to
  generic navy/blue email defaults). `FAST_MODEL` (`claude-haiku-4-5`,
  `lib/clients/anthropic.ts`) + one forced tool call (`prompts/brand-identity.ts`,
  `app/api/settings/brand-identity/route.ts`) now generates a color palette +
  a font pairing chosen from a curated, email-safe list (`FONT_PAIRINGS`, no
  invented font stacks). ~1.8k input / ~250 output tokens per call, verified
  live. Two contrast safety nets in the route: text/background must clear
  WCAG AA (4.5), and the accent (white CTA-button text on it) is
  programmatically darkened until it clears AA-large (3.0), since a
  from-scratch palette has nothing to validate against upfront the way
  website-import candidates do. No logo image generation (explicit scope
  decision): the email design system already renders a styled text wordmark
  when `logo_url` is empty. Wired into Settings ("Generate brand identity",
  next to "Import from website") and into onboarding automatically when no
  website is given, reusing the same `ImportReview` component (only the
  visual identity section populates). `BrandImportProposal.source_url` /
  `pages_scraped` are now optional to support this non-scraped case.
  **Scrape-grounded fallback added same day:** the generator logic moved to
  a shared `lib/pipeline/brand-identity.ts` (`generateBrandIdentity()`) used
  by both the standalone route and `app/api/settings/import-website/route.ts`.
  When a website scrape succeeds but its CSS yields NO usable colors (a real
  failure mode: oklch()-only sites like the 37signals family), the import
  route now calls the identity generator grounded in that scrape's own
  signals (`scrape.signals.color_candidates`/`font_candidates`/`site_name`/
  `meta_description`, plus the voice/positioning just extracted from the
  same pages) instead of leaving `visual_identity` empty.
  `buildBrandIdentityMessages` (`prompts/brand-identity.ts`) instructs the
  model to prefer real site colors/fonts for whichever roles they plausibly
  fill, inventing complementary colors only for the rest; verified live
  against 37signals.com (0 color candidates, 3 font candidates) that the
  grounded reasoning explicitly references the site's real font ("Lab
  Grotesque's geometric roots") versus a materially different blind result.
  Both contrast safety nets still apply regardless of grounding.
- **Design-adjustment chat (2026-07-03):** on the draft review screen, a
  small chat-style panel (`design-chat.tsx`) lets you type a free-form style
  instruction ("change the header to a gradient", "darken the background")
  and applies it to the CURRENT draft's HTML in place, no new draft version,
  copy untouched. Deliberately not an agent: one non-thinking `DRAFT_MODEL`
  call per instruction (`lib/pipeline/adjust-style.ts`,
  `app/api/drafts/[id]/adjust-style/route.ts`), reusing the same
  `validateModelEmailHtml`/`ensureUnsubscribeTag` guarantees generation
  relies on (now exported from `lib/pipeline/generate.ts`). Distinct from
  "Reject & regenerate": that rewrites copy and counts against
  `MAX_DRAFT_VERSIONS`; this doesn't, since it's meaningfully cheaper (no
  thinking, no copy fields, smaller output) and meant for quick iteration.
  Verified live against a real draft: visible text content came back
  byte-identical (2828 chars before and after) while the requested gradient
  was actually applied, `{$unsubscribe}` and em-dash guarantees held.
  **Real bug found and fixed same day, from live use:** asking to change
  "the header to a gradient" applied to the header BAR's background (a
  reasonable default reading), but the user meant the header TEXT; a second
  attempt to correct it just flattened the wordmark to solid black with no
  visible gradient (the model had no taught technique for gradient text,
  and the client-only undo was already gone because the page had reloaded).
  Fixed three things: (1) `prompts/adjust-email-style.ts` now explicitly
  disambiguates "header"/"header bar" (background) vs "header text"/
  "headline"/"wordmark" (the text itself), and teaches the actual
  `background-clip:text` + `-webkit-text-fill-color:transparent` technique
  for gradient text, with a REQUIRED solid-color fallback (the tool can
  return an optional `client_support_caveat`, e.g. noting Outlook desktop
  will show the fallback color instead of the gradient). (2) Fixed the
  design-chat's own placeholder example, which was itself ambiguous
  ("Make the header a gradient...") and had primed the exact
  misunderstanding. (3) **The real root cause**: undo was client-memory-only
  and vanished on reload with zero server-side history, so a bad edit had no
  recovery path. Replaced with a server-authoritative undo stack in
  `drafts.meta.style_edit_history` (jsonb, no migration needed, capped at
  10 entries) via `getStyleEditHistory()`/`undoLastStyleEdit()` in
  `lib/pipeline/adjust-style.ts`; the API route gained GET (hydrate
  history on page load) and DELETE (undo) handlers; `design-chat.tsx`
  fetches history on mount so it survives reloads. Verified live: a
  2-edit-deep apply→apply→undo→undo round trip against a real draft landed
  byte-identical back on the pre-edit original. New query:
  `updateDraftContent()` in `lib/db/queries.ts` now optionally writes
  `meta` atomically alongside `content`.
- **Adjust-style rebuilt as find/replace patches on FAST_MODEL, same day:**
  the model used to echo back the ENTIRE HTML document on every single-word
  tweak. Rebuilt `prompts/adjust-email-style.ts`/`lib/pipeline/adjust-style.ts`
  around a `save_style_patch` tool (`edits: {find, replace, replace_all?}[]`)
  where the model outputs only the small exact-match snippet(s) that change;
  `find` must literally exist in the current HTML (verbatim, checked in code)
  or the edit fails closed rather than guessing, which is also a safety
  property: the model is mechanically unable to touch anything outside the
  span it names. Live A/B measured on a real draft: **54.3s / 4,687 output
  tokens (old, full-doc, Sonnet) → 2.7s / 113 tokens (new, patch, Sonnet)**,
  roughly 20x faster. Switched the model to `FAST_MODEL` (Haiku): verified
  it correctly handles the exact case that broke this feature (header BAR
  vs header TEXT gradient, including the real `background-clip:text`
  technique with an honest client-support caveat). One real finding from
  testing: an exact-match `find` can occasionally miss on Haiku sampling
  variance alone (rare, confirmed live), so `adjustEmailStyle` now retries
  once on Haiku, then falls back to `DRAFT_MODEL` (Sonnet) once, before
  ever surfacing an error, absorbed transparently, verified across 3
  repeated full test cycles (6/6 edits succeeded, every undo round-trip
  landed byte-identical).
- **Archive for topics and drafts (needs migration 003 applied):** neither
  had any hide/remove UI before, topics only had a hard-delete restricted to
  idea-stage (content_jobs.topic_id is ON DELETE SET NULL, so deleting a
  topic with real generation history would orphan its drafts, hence the
  restriction). Added a soft `archived` boolean to both tables instead
  (`db/migrations/003_archive_topics_drafts.sql`, folded into `db/schema.sql`
  too), always safe regardless of status since it's just a display filter,
  nothing cascades. `archiveTopic()`/`archiveDraft()` in `lib/db/queries.ts`
  + `app/api/topics/[id]/archive` and `app/api/drafts/[id]/archive` routes
  (POST archives, DELETE unarchives). Content Plan (`content-plan.tsx`
  wrapping `cluster-card.tsx`) gained a "Show archived (N)" toggle and an
  Archive/Unarchive button on every topic regardless of status; Emails tab
  gained an "Archived" filter segment (only shown when non-empty); the
  draft review screen (`review-actions.tsx`) gained its own Archive button.
  **Jordan must apply migration 003 in the Supabase SQL editor before this
  works live** — the `archived` column doesn't exist in the live DB yet.
- **Instant full redesign, same day:** investigated "my background is stuck
  black and targeted edits don't fix it" — root cause was NOT a bug: the
  brand's own `visual_identity.colors.background` is genuinely `#000000`,
  and it (plus several derived near-black shades: `#111111`, `#0d0d0d`,
  `#1f1f1f` etc.) is baked into MULTIPLE different literal spots across a
  generated design. A single find/replace patch can only ever fix one
  literal string at a time, so it could never reach all of them in one
  instruction. Built a third action alongside Adjust-design (patches) and
  Reject & regenerate (full copy+design rewrite): **Redesign**
  (`prompts/redesign-email.ts`, `lib/pipeline/redesign.ts`,
  `app/api/drafts/[id]/redesign/route.ts`, a button in `design-chat.tsx`)
  keeps the exact stored copy (`drafts.meta.email_copy`, already saved at
  generation time) completely fixed as INPUT and asks the model to design a
  fresh HTML document from scratch under the same design brief + CURRENT
  brand tokens, so a consistent palette applies everywhere in one shot
  instead of needing N patches. No thinking, no copywriting (same
  Haiku-then-Sonnet-escalation reliability pattern as adjust-style), so
  it's cheap despite regenerating the whole document (~15s live measured).
  Shares the same `style_edit_history` undo stack as adjust-style (one
  undo model for all style-only operations). **Verified rigorously, not
  just assumed:** a naive full-text diff first showed "not identical" but
  that was the test's own fault, it didn't strip `<style>`/`<script>`
  block CONTENTS or the hidden preheader's padding filler; after fixing the
  comparison, every actual sentence of subject/preheader/headline/body/cta
  matched exactly. Two real findings from testing, both fixed: (1) the
  eyebrow label and any stat-highlight callouts are NOT part of stored
  copy, they're decorative flourishes the model invents from context each
  design pass, so `buildRedesignMessages` now also receives the topic +
  offer block (`buildOfferBlock`, exported from `prompts/generate-email.ts`)
  the original generation had, which measurably improved consistency (e.g.
  eyebrow correctly stayed "Systems & Automations" instead of drifting to
  an invented "Lead Systems"). (2) Decorative elements not in the stored
  copy (numbered step badges, a stats bar) may still legitimately differ
  between any two design passes since they're genuinely re-invented each
  time, not a guarantee this feature makes or breaks; only the actual
  written words are guaranteed unchanged.
- **Runtime error fixed same day:** `listDrafts()`/`getDraftForReview()`
  hard-selected the new `archived` column by name, so any live DB without
  migration 003 applied hit Postgres error 42703 (undefined_column) and
  broke the Emails tab and every draft page outright. Fixed with the same
  fallback-select pattern already used elsewhere in `lib/db/queries.ts`
  (`getDraftWithJobContext`'s campaign_id fallback): retry without
  `archived` on error, default `archived: false`. Verified live against
  the real (still pre-migration) database. Browsing works regardless of
  whether migration 003 has been applied; only the archive ACTION itself
  still needs it.
- **Override permission for brand guidelines/tokens, same day:** Jordan
  flagged that `buildGuidelinesBlock()` (`prompts/brand-voice.ts`, injected
  into email generation, the campaign chat, and topic suggestions) said
  guidelines "override any conflicting instruction below", a blanket rule
  with no carve-out for the user's OWN explicit request for this piece.
  Same issue in `buildEmailDesignBrief()`'s "use these exact values"
  (`prompts/email-design.ts`). Reworded both: brand guidelines/tokens are
  now explicitly the DEFAULT when the user hasn't said otherwise, but an
  explicit user instruction for this piece wins when it conflicts.
  `prompts/adjust-email-style.ts` got the same explicit permission for
  named colors. The bigger gap: **Redesign had literally no way to accept
  creative input at all**, no parameter existed. Added an optional
  `direction` argument threaded through `buildRedesignMessages` →
  `redesignEmail()` → the API route → `design-chat.tsx` (whatever's typed
  in the instruction box when you click Redesign instead of Apply becomes
  the override; empty just reapplies current brand tokens). Verified live:
  redesigning with no direction kept the brand's `#000000` background
  token; redesigning with an explicit "use a deep purple background
  instead of black, #4C1D95" correctly dropped the token and used exactly
  that purple.

## What's not built yet

- **Slice 3 — Publish email to MailerLite:** no MailerLite client exists
  under `lib/clients/`, no `lib/pipeline/publish.ts`, `MAILERLITE_API_KEY`
  unset. This is the next slice per the original roadmap.
- **Slice 4 — Keyword research (DataForSEO):** not started.
- **Slice 5 — Blog path (Sanity, Portable Text):** not started; no Sanity
  client exists yet.
- **Slice 6 — SEO/QA pass:** `prompts/qa-email.ts` exists but there's no
  second-pass QA route/pipeline wired to it yet — verify before assuming
  it's live.
- **Slice 7 — Distribution/repurposing checklist:** not started.
- Logo: `Mogul Assets/mdalogo.jpeg` was to be copied into `public/` and
  optionally uploaded to a Supabase `logos` bucket so generated emails use
  the real mark (`visual_identity.logo_url`) — bucket creation was pending
  as of the redesign plan; verify current state before assuming it's done.

## Next step

Slice 3: build the MailerLite client (`lib/clients/mailerlite.ts`) and
publish pipeline (`lib/pipeline/publish.ts`) that takes an approved draft
and creates a MailerLite draft campaign, storing the external id on
`publications` (the `unique(job_id, target)` constraint backs idempotency —
a retry must never double-post). Needs `MAILERLITE_API_KEY` in `.env.local`
and its request/response shape verified against live MailerLite docs before
integrating (per `CLAUDE.md` — don't assume API shapes from memory).

## How to verify this doc against reality

This file is written from a point-in-time read of the repo (2026-07-03).
Before trusting a claim above, spot-check it:

- `ls lib/clients/` — confirms which external API clients actually exist.
- `git log --oneline -20` — confirms what's actually been committed.
- `grep -rn "MAILERLITE\|SANITY\|DATAFORSEO" .env.example` — confirms which
  env vars are expected/wired for later slices.
