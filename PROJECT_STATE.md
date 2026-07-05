# Project State

Living save/restore doc. Read this first to pick up context; update it
whenever progress, blockers, or decisions change.

Last updated: 2026-07-05 (AI hero images, blog path to Sanity, publishing
provider abstraction, prompt caching split, quality gates — the
distributed-booping-possum plan, implemented end to end).

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

- **Email Creator UX Overhaul, Phase 0 + Phase 1 (2026-07-04):** working
  through `structured-gliding-sunrise.md` (non-technical-owner UX pass).
  - **Phase 0 — UI-kit primitives:** added `Progress` (bar/ring,
    determinate/indeterminate), `Tooltip`, `Toast`/`ToastProvider`/`useToast`
    (mounted in `app/layout.tsx`), `Checkbox`, `Select`, `Skeleton`,
    `ConfirmDialog` to `components/ui/`, all exported from the barrel. Not
    yet wired to call sites except `Select` in `quick-generate.tsx` — the
    rest (toasts replacing inline error `<p>`s, checkbox/select swaps,
    `ConfirmDialog` replacing `window.confirm`) is Phase 5.
  - **Phase 1 — Honest generation wait:** killed the fake 7-string/5s
    rotator. `DraftMeta.generation` (`lib/db/types.ts`) tracks
    `status/phase/label/started_at/error`. `persistEmailDraft` split into
    `createDraftShell` + `populateDraft` + `patchDraftGeneration`
    (`lib/db/queries.ts`). `lib/pipeline/generate.ts`'s old synchronous
    `generateEmailForTopic` is gone, replaced by
    `generateEmailForTopicStreamed(draftId, ctx, opts, onEvent)` which fills
    in an existing shell and emits `phase`/`done`/`error` events.
    `POST /api/generate` and the assistant's `generate_email` tool
    (`app/api/assistant/chat/route.ts`) now just call `createDraftShell` and
    return instantly. New `GET /api/drafts/[id]/generate-stream` (SSE,
    `maxDuration=300`) does the actual work: idempotent (emits `done`
    immediately if already ready), and dedupes concurrent connections for
    the same draft via an in-memory run registry
    (`lib/pipeline/generation-runs.ts`, single-instance only — noted as a
    known limitation for multi-instance hosting). Client:
    `lib/use-generation-stream.ts` (SSE reader hook) +
    `GenerationProgress` (`app/(dashboard)/drafts/[id]/_components/`),
    swapped in on the draft page whenever `meta.generation.status !==
    "ready"`. `quick-generate.tsx` no longer has the `STATUSES`
    array/`setInterval`/`PenAnimation`/`ThinkingDots`; all three triggers
    (QuickGenerate, GenerateButton, Assistant) now navigate the instant a
    draft id comes back.
  - Verified live (not just typecheck/build): a standalone script drove
    `createDraftShell` → `generateEmailForTopicStreamed` against the real
    Supabase + Anthropic, confirmed shell → `writing` → `checking` → `done`
    → populated content, then cleaned up the test row. The SSE route itself
    is behind Supabase Auth middleware, so its HTTP path wasn't
    curl-tested — verify Phases 1's UI in-browser (logged in) before
    considering it fully done.
  - **Phase 2 — Click-to-edit creative control:** `data-region` attrs
    (header/eyebrow/headline/body/cta/footer) added to both HTML paths —
    the model prompt (`prompts/email-design.ts`, a new "REGIONS" block) and
    the code-template fallback (`lib/email/templates/shared.ts` +
    `paragraphs()` wraps body copy in `data-region="body"`, each template's
    inline `<h1>` tagged `headline`). New `EmailPreview`
    (`app/(dashboard)/drafts/[id]/_components/email-preview.tsx`) reads
    `iframe.contentDocument` (sandbox now `allow-same-origin`, still no
    `allow-scripts`), overlays hover hotspots, and opens a `Sheet` with
    suggestion chips ("Make it bolder", etc.) + free text. `adjustEmailStyle`
    (`lib/pipeline/adjust-style.ts`) and `buildAdjustStyleMessages`
    (`prompts/adjust-email-style.ts`) take an optional `regionCtx {region,
    label, snippet}` that prefaces the model call with the exact region
    HTML, scoping the find/replace edit. `review-actions.tsx` now uses
    `EmailPreview` instead of the bare iframe; `DesignChat` remounts (via a
    `historyRefreshKey`) after a region edit so its history log stays in
    sync. Verified live: a real generated email carried all 6 regions, and
    a region-scoped "Make it bolder" edit on the headline landed correctly
    without touching other regions; the template-fallback path was checked
    directly (`renderEmailTemplate`) and also carries all 6.
  - **Phase 3 — Campaign-chat quick-reply chips:** new `suggest_options`
    tool (`prompts/campaign.ts`, `SuggestedOption {id,label,kind}`) added to
    `CAMPAIGN_TOOLS`; the interview directive now tells the model to call it
    with 1-3 fitting topics instead of describing them in prose.
    `app/api/campaigns/chat/route.ts` handles the tool call in
    `applyContentBlocks` (validates topic ids against the real TOPICS list,
    same guard as `select_topic`) and returns `options` on `TurnResponse`.
    `campaign-chat.tsx` renders them as tappable chips under the thread;
    tapping one sends its label as the next message, same code path as
    typing it. (Not live-tested this session — see billing note below.)
  - **Phase 4 — Review-screen relabel:** `review-actions.tsx` renamed
    jargon ("QA results" → "Quality check", "Issues to address" → "Things
    to improve", "Banned terms found" → "Words we avoided", keyword
    line → "Search phrase: used/not used yet", meta title/description →
    "Page title"/"Page summary" under a new "Web version details" label
    with a one-line hint that they're for the blog/web version, not the
    email). Added a `Tooltip` on "Quality check" explaining what it covers.
    Deleted the raw-HTML editor (`showHtmlEdit` toggle + textarea) and the
    template-ID "Layout" `SegmentedControl` from the Reject sheet (incl.
    `LAYOUT_OPTIONS`); the reject route already treated `templateOverride`
    as optional so no backend change was needed. No literal "funnel stage"
    label existed on this screen to tooltip-ify, despite the plan
    mentioning it as an example — nothing was force-fit there.
  - **Phase 5 — Hygiene tail (mostly done, incremental by design):** wired
    the Phase 0 primitives across real call sites: `Checkbox` in
    `suggest-topics.tsx` and `import-review.tsx`'s `SectionCheckbox`;
    `Select` in `cluster-card.tsx` (deleted the old `SELECT_CLS`);
    `ConfirmDialog` replacing `window.confirm` for topic delete in
    `cluster-card.tsx`; `Skeleton` fallbacks via `app/(dashboard)/loading.tsx`
    (generic, since it's the Suspense boundary for any nested dashboard
    route without its own loading.tsx), `app/(dashboard)/emails/loading.tsx`,
    and an iframe-load skeleton inside `EmailPreview`. Replaced inline
    `text-danger` error paragraphs with `useToast().error(...)` and added
    `useToast().success(...)` on save, across: all 6 named settings forms
    (brand-basics, icp, funnel, positioning, products, visual-identity) plus
    brand-voice/guidelines (kept guidelines' "draft below" hint inline since
    it's state, not an error), `suggest-topics`, `import-review`,
    `quick-generate`, `generate-button`, `import-website-form`,
    `generate-identity-form`, `login-card`, `create-brand-form`, and
    draft-approve/draft-archive/topic-archive in `review-actions.tsx` /
    `cluster-card.tsx`. Left conversational/contextual inline errors alone
    on purpose (design-chat entries, campaign-chat, assistant, onboarding
    chat, the region-edit Sheet, `suggest-button`'s in-place placeholder) —
    those read better as part of their specific bubble/card than as a
    floating toast. Not done (genuinely low-priority, explicitly
    incremental per the plan): a handful of smaller pages could still get
    Skeleton fallbacks (settings tab, create tab) if it comes up later.
  - **Known gap this session: Anthropic API billing.** The account hit
    "credit balance too low" partway through Phase 3 verification (after
    real generations were run live for Phases 1 and 2). Phases 3-5 are
    typecheck+build clean and carefully code-reviewed but NOT exercised
    against a real Claude call this session (campaign chat's
    `suggest_options`, the click-to-edit chip flow end-to-end in a browser,
    etc.) — top up credits and manually click through before considering
    this fully verified in production.

- **Click-to-edit wording + color, CTA link, download .html (2026-07-05,
  uncommitted on `feat/dashboard-create-agent` as of this writing):**
  extends the click-to-edit region Sheet (`email-preview.tsx`) from
  style-only to three edit kinds per region:
  - **Wording:** a textarea pre-filled with the region's visible text.
    "Apply text" swaps it in verbatim; "Regenerate" rewrites it in the same
    voice, optionally guided by free text. New `save_copy_patch` tool
    (`prompts/adjust-copy.ts`) + `adjustCopy()` (`lib/pipeline/adjust-copy.ts`)
    + `POST /api/drafts/[id]/copy`. After a verbatim edit, best-effort syncs
    the new text back into `meta.email_copy` (headline/cta_text/body_sections)
    so a later Redesign (which rebuilds from `email_copy`) doesn't revert the
    wording; skipped silently if the region doesn't map to a single field.
  - **Color:** a native color picker (swatch + hex input) pre-filled by
    best-effort regex-scanning the region's own snippet for its current hex
    (display only; the model decides the real target property). "Apply
    color" sends the exact hex, no free text, no ambiguity. New
    `save_color_patch` tool (`prompts/adjust-color.ts`) +
    `adjustColor()` (`lib/pipeline/adjust-color.ts`) +
    `POST /api/drafts/[id]/color`. The prompt teaches the model which CSS
    property is "the" color per region shape: background-color for a
    filled/button region (bumping text color too only if the new fill would
    make it unreadable), text color for plain-text regions, link color if
    that's the dominant element. **Verified live** against a real draft on
    both branches: a CTA button's `background-color` swapped to an exact
    target hex leaving its white text alone, and a headline's plain `color`
    swapped to a different exact hex, both with the rest of the document
    byte-identical and the draft restored after the test.
  - Refactored the shared tail of all three region-edit pipelines
    (style/copy/color) into `lib/pipeline/html-edit.ts`:
    `applyEdits()` (the find/replace-with-fail-closed-ambiguity logic,
    previously duplicated) and `commitHtmlEdit()` (validate, strip
    em-dashes, guarantee unsubscribe tag, push undo history, persist).
    `EditType` (`"style" | "copy" | "recolor"`) on
    `StyleEditHistoryEntry.type` labels which kind of edit each undo entry
    was, for display; the undo stack itself stays shared (one Undo button
    covers all three). `adjust-style.ts` now delegates to `html-edit.ts`
    instead of carrying its own copy of this logic.
  - **CTA link field:** `review-actions.tsx` gained a "CTA link" input
    reading/writing `meta.email_copy.cta_url`; typing a URL rewrites the
    `<a>` href inside the `data-region="cta"` wrapper directly via regex
    (`applyCtaHref`), no model call, applied instantly to the live preview.
  - **Download .html button** on the preview card header: client-side blob
    download of the current rendered HTML, filename derived from the
    subject.
  - **Fixed a real meta-clobbering bug found while wiring the CTA field:**
    `approveDraft()` (`lib/db/queries.ts`) used to flat-replace `meta` with
    whatever the client had at page-mount, which would have silently
    reverted any in-place edit pipeline's write (style/copy/color history,
    a copy-synced `email_copy`) made after the page loaded, the instant you
    hit Approve. Now merges: re-reads the current stored `meta` server-side
    and layers only the fields the client actually owns (the two SEO text
    fields, `email_copy.cta_url`) on top, instead of replacing the whole
    object.
  - Added `logUsage()` (`lib/clients/anthropic.ts`): one-line cache-hit/miss
    token log per Anthropic call, wired into the email-copy and QA calls in
    `lib/pipeline/generate.ts` (dev-time visibility, not wired into every
    pipeline).
  - A `color_overrides` (brand-wide, per-role) meta field was scaffolded
    earlier in this session, then **removed**: Jordan's actual ask was
    per-region ("click on a section or text and change the color"), which
    the region-scoped color pipeline above satisfies directly without
    needing a persisted brand-level override.
  - Not yet exercised against a live logged-in browser session this pass
    (auth middleware blocks a plain curl test); the pipeline itself was
    verified directly against real Supabase + Anthropic data as described
    above. Click through all three Sheet sections in the browser before
    calling this fully done.

## 2026-07-05 session — images, blog, publishing abstraction, prompt hardening

Implemented the plan `~/.claude/plans/distributed-booping-possum.md` end to
end (this section absorbs and replaces the deleted IMPLEMENTATION-HANDOFF.md).
All uncommitted on `feat/dashboard-create-agent` on top of `bc842a0`.
`npm run typecheck`, `npm run build`, and `npm test` all green.

**Feature A — AI hero images (Gemini):**
- `lib/clients/gemini-image.ts` (Interactions API, default model
  `gemini-3.1-flash-image`, `GEMINI_IMAGE_MODEL` overridable),
  `prompts/generate-image.ts` (3 deterministic style scaffolds seeded with the
  brand palette; Haiku crafts only the scene), `lib/images/optimize.ts`
  (sharp → ≤1200px JPEG under ~150KB), `lib/pipeline/generate-image.ts`
  (generate → optimize → Supabase `content-images` bucket, self-creating),
  `app/api/drafts/[id]/image/route.ts` (POST/DELETE through `commitHtmlEdit`,
  shared undo stack). Click-to-edit "image" region + floating "+ Add image"
  pill in `email-preview.tsx`. Images are opt-in per draft, never automatic;
  persistence across regenerate/redesign is guaranteed in CODE via
  `spliceHeroImage`, prompts are advisory. **Blocked on `GEMINI_API_KEY` in
  `.env.local` (Jordan to add) — everything degrades gracefully until then.**

**Feature B — Blog path (Sanity):**
- `lib/clients/sanity.ts` (lazy singleton, `isSanityConfigured`, env
  `SANITY_PROJECT_ID/DATASET/WRITE_TOKEN`, optional `SANITY_POST_TYPE`).
- `prompts/generate-blog.ts` — forced `save_blog_draft` tool, SEO rules
  (keyword in title + first 100 words + a heading, slug/meta constraints,
  weaves `topic.internal_link_targets`), reuses the shared brand blocks.
- `lib/blog/to-portable-text.ts` — hand-rolled markdown → Portable Text
  (no DOM dep), **unit-tested** (`npm test`, vitest, 10 tests);
  `lib/blog/render-preview.ts` renders the SAME Portable Text to the review
  preview via `@portabletext/to-html`, so what you review is what ships.
- `lib/pipeline/generate-blog.ts` mirrors the email SSE shell→writing→
  checking→done flow; blog drafts reuse the `drafts` table with content
  `{subject: title, preheader: meta_description, html: preview}` and the
  structured post in `meta.blog_copy`. Code-level QA (banned terms, keyword
  placement, meta lengths), no model QA call.
- Wiring: `createDraftShell` takes `type`, `/api/generate` takes
  `channel: "email"|"blog"`, `joinRun` picks the runner by job type, the
  draft review page branches to `blog-review-actions.tsx` (approve gates +
  publish-to-Sanity card), the create agent's brief card has an
  Email/Blog-post toggle, the Emails list labels blog drafts.
- **Blog reject/regenerate is deliberately not built yet** (email-only);
  approve/archive/publish are.

**Part 6 — Publishing provider abstraction:**
- `lib/publishing/provider.ts` (PublishProvider interface) +
  `registry.ts` (adding a platform = one adapter file + one registry line) +
  adapters `providers/sanity.ts` (creates a Sanity DRAFT doc,
  `drafts.content-engine-<jobId>` via createIfNotExists → doubly idempotent)
  and `providers/mailerlite.ts` (verified against live MailerLite docs:
  `POST connect.mailerlite.com/api/campaigns`, Bearer auth; creates the
  campaign WITHOUT scheduling, the send stays a human act in MailerLite).
- `lib/pipeline/publish.ts` — provider-agnostic `publishDraft`: approved-only
  gate, publications-row check BEFORE any external call, races tolerated in
  `recordPublication` (23505 → read back), then `markJobPublished`.
- `app/api/drafts/[id]/publish/route.ts`; Connections group in Settings
  driven by the registry (env-status v1).
- **Migration 004** (`db/migrations/004_publishing_providers.sql`, mirrored
  in `schema.sql`): `publications.target` check relaxed to plain text +
  `brand_integrations` table. **Not yet applied to live Supabase.**
- This supersedes the "publishing deferred" lock above: the LAYER is built;
  actually sending still requires keys + explicit clicks, so the
  approval-gate contract is intact.

**Tier 1 / Part 4 / Part 5 product hardening:**
- Review screen: subject-variant picker chips, "this draft cost ~$X" line
  (from `meta.usage`, rolled up via `lib/pipeline/cost.ts`), QA-issues nudge
  on approve, and a server-enforced banned-terms approve gate
  (`/api/drafts/[id]/approve` re-runs `findBannedTerms`, 409 + terms unless
  `force: true`; ConfirmDialog override in the client). Detection only,
  never auto-delete.
- QA pass runs on FAST_MODEL over structured copy (not HTML); code-level
  banned-term + WCAG-AA contrast checks in `lib/email/quality.ts` run even
  if the model call fails.
- Brand-readiness checklist (`lib/brand-readiness.ts` +
  `BrandReadinessCard` on Home): scores 10 brand-brain inputs, hides when
  complete.
- Prompt cache split: `buildCampaignSystem`/`buildCreateAgentSystem` are now
  byte-stable across turns (no brief inside); the volatile BRIEF SO FAR rides
  at the top of the LATEST user message (`buildBriefStateBlock`) and is never
  persisted to history. Shared `buildProductLines`/`buildTopicLines`/
  `buildFunnelBlock` live in `prompts/brand-voice.ts` (campaign, create-agent,
  suggest-topics all use them).
- `postal_address` (CAN-SPAM/GDPR): settings input + code-template footer +
  model design brief.
- `subject_variants` + COPY PRINCIPLES block in `prompts/generate-email.ts`;
  preheader "extends, never restates"; `<html lang="en">` required in the
  design brief.

## 2026-07-05 session 2 — draft delete + email-to-blog spin-off

Jordan flagged two missing affordances: no way to delete emails, and no way to
create a blog from an existing email. Both implemented on top of the work
above, uncommitted on `feat/dashboard-create-agent`. typecheck + build + test
green.

- **Hard-delete for drafts.** `deleteDraft()` + `isJobPublished()` in
  `lib/db/queries.ts`. New `DELETE /api/drafts/[id]` route gates on
  `isJobPublished`: a draft whose job has any `publications` row is blocked
  with 409 (permanent record, archive instead); everything else
  (in-review, approved-not-published, rejected) is deletable. `approvals`
  cascade automatically (FK is ON DELETE CASCADE), so a delete is literally
  `delete from drafts`. The parent `content_job` and topic are deliberately
  left in place so a delete means exactly "remove this draft," not a silent
  topic status flip. Delete button (ghost, danger text) + ConfirmDialog on
  BOTH review screens (`review-actions.tsx`, `blog-review-actions.tsx`),
  alongside the existing Archive.
- **Per-row actions on the Emails list.** The list used to be navigation-only;
  every action needed opening the draft. Each row now has inline Archive
  (toggles to Unarchive in the Archived tab) and Delete icon buttons. Built as
  a custom row in `emails-list.tsx` rather than the `href` `ListRow`, because
  `ListRow` renders a single `<a>` and can't nest action buttons (invalid
  HTML): the open-link is the row's text block, the icon buttons are siblings,
  so they never trigger navigation. Three new icons (`ArchiveIcon`,
  `UnarchiveIcon`, `TrashIcon`) in `components/ui/icons.tsx`. Archive is
  instant with a toast + `router.refresh()`; Delete opens the same
  `ConfirmDialog` used on the review screen and reuses the published-blocks
  409 path.
- **Create blog post from an email.** New `POST /api/drafts/[id]/create-blog`
  route resolves the source draft's topic (and campaign, if any) via
  `getDraftWithJobContext`, then calls `createDraftShell({ type: "blog" })` on
  that same topic, no re-briefing. The blog pipeline generates fresh long-form
  SEO content from the topic independently of the email; the new draft's page
  picks up generation via the SSE stream (same shape as `/api/generate`, fast
  DB writes only). The email review screen gained a "Create a blog post from
  this topic" card above the actions row; clicking it navigates to the new
  blog draft, which streams in like any other generation. The email's own
  copy is NOT threaded into the blog prompt by design (the blog pipeline is
  topic-grounded and standalone); that's a possible later enhancement.
- Not yet exercised against a live logged-in browser session this pass (auth
  middleware blocks plain curl); the routes are server-only and behind the
  existing server-only boundary. Click through both in the browser before
  calling fully verified.

## 2026-07-05 session 3 — image placement, editor simplification, blog images, auto-image setting, dark mode (CODE COMPLETE)

Jordan's asks this session: (1) fix the email image landing in the wrong
place, (2) make the email editor simpler while keeping every tool, (3) image
creation for blogs, (4) ask during project setup whether images should be
auto-created (still human-approved), (5) automatic dark/light mode for emails
and blogs (added mid-session). All five are implemented. All work is
UNCOMMITTED on `feat/dashboard-create-agent` on top of `875df0f` (which is 1
commit ahead of origin). Verified: `npm run typecheck` clean, clean
`npm run build` green (note: two builds racing over one `.next` dir corrupt
it — always build once, cleanly), `npx vitest run` 19/19 (9 NEW placement
tests in `lib/email/hero-image.test.ts`), dev server boots with the correct
auth redirect. NOT yet verified: logged-in browser click-through (all keys
incl. GEMINI/SANITY are present in `.env.local`, so image generate, blog
publish-with-mainImage, and the dark variants can all be exercised live).

**The plan (decisions locked this session):**
- Image placement is a first-class control: `ContentImage.placement`
  (`"top" | "below_headline" | "above_cta"`, undefined reads as "top").
  Moving an existing image is a pure string splice (mode "move" on the image
  route), instant, no model call. The design brief tells regenerating models
  where the hero goes via `HERO_PLACEMENT_DIRECTIVES` so prompt and code
  splice never disagree.
- One shared ImageSheet component for emails AND blogs (generate/upload
  tabs, style chips, reference image + use, placement chips for email only;
  tapping a placement chip with an image present moves it immediately and
  closes the sheet).
- Editor simplification: preview card FIRST (review is the product), then
  DesignChat, then an "Email details" card (subject/variants/preheader/CTA),
  then Quality check. Region sheet is now ONE tool at a time via
  SegmentedControl tabs (Wording | Color | Style). DesignChat helper text
  cut from a paragraph to two sentences. All tools kept.
- Blog heroes: pinned under the title (no placement choice), stored in
  `meta.hero_image`, preview re-rendered server-side from `blog_copy` via
  `renderBlogPreviewHtml(copy, brand, hero)` (blogs do NOT go through
  commitHtmlEdit — no unsubscribe/email-validation on blog HTML). Sanity
  publish uploads the hero via `assets.upload("image", ...)` and attaches it
  as `mainImage` (+alt); publish fails loudly if the image can't be
  mirrored (what you review is what ships).
- Auto-image pref lives in `brand.visual_identity.image_gen`
  (`ImageGenPrefs { auto?: boolean; style?: ContentImageStyle }`, jsonb, NO
  migration needed). Onboarding chat asks it; Settings → Visual identity
  gets a toggle + default style. Generation pipelines (email + blog)
  auto-generate a hero when `auto && isGeminiConfigured()`, non-fatal on
  error, FIRST generation only (regenerations keep the existing hero;
  a deliberately removed image must not come back). Approval gate unchanged.

**Done so far (files touched, all working-tree only):**
- `PRODUCT.md` — new (impeccable skill context; register=product).
- `lib/db/types.ts` — `HeroPlacement`, `ContentImage.placement`,
  `ImageGenPrefs`, `VisualIdentity.image_gen`.
- `lib/pipeline/generate-image.ts` — `spliceHeroImage` rewritten
  placement-aware (removes any existing hero block first, then inserts at
  the placement's anchor with graceful fallback chain; `elementStart`/
  `elementEnd` helpers). Header comment updated for the auto mode.
- `prompts/email-design.ts` — `HERO_PLACEMENT_DIRECTIVES`, IMAGE block now
  placement-aware.
- `prompts/generate-image.ts` — scene-crafting wording covers blogs too.
- `lib/blog/render-preview.ts` — optional `hero` param renders
  `<figure class="hero">` under the title.
- `app/api/drafts/[id]/image/route.ts` — rewritten: `placement` form field,
  new mode `"move"`, blog branch (`commitBlogHero` re-renders the preview and
  writes `meta.hero_image`; DELETE also branches for blogs).
- `app/(dashboard)/drafts/[id]/_components/image-sheet.tsx` — NEW shared
  ImageSheet as described above.
- `email-preview.tsx` — rewritten: image tool delegated to ImageSheet
  (image hotspot + "+ Add image" open it), region sheet tabbed
  (Wording | Color | Style), takes `initialImage` prop.
- `review-actions.tsx` — reordered (preview → DesignChat → Email details →
  Quality check → regen status → blog card → actions); passes
  `initialImage={initialMeta.hero_image}`.
- `design-chat.tsx` — helper copy trimmed.
- `blog-review-actions.tsx` — html/heroImage state, "+ Add image"/"Change
  image" button on the preview header, ImageSheet kind="blog", download uses
  live html.
- `lib/publishing/providers/sanity.ts` — `uploadMainImage()` + `mainImage`
  on the published doc (API shape verified against installed
  @sanity/client typings: `assets.upload("image", Buffer, opts) →
  SanityImageAssetDocument`).

**Also done since the first save point:**
- Auto-image setting COMPLETE end to end:
  - `prompts/onboarding.ts`: `auto_images` tool field + checklist topic 9
    ("one visual thing you do ask"), current-profile line, complete-list
    mention.
  - `app/api/onboarding/chat/route.ts`: `applyProfileUpdates` writes
    `visual_identity.image_gen.auto` via `updateVisualIdentity` (merged,
    colors/fonts/logo untouched).
  - `visual-identity-form.tsx`: "AI images" section — Checkbox ("Create an
    image automatically with each new draft") + default-style Select, saved
    through the existing PATCH payload as `image_gen: { auto, style }`.
  - `lib/pipeline/generate.ts`: exported `maybeAutoHeroImage(ctx, headline,
    usageDeltas, {draftId, onEvent})` — checks pref + `isGeminiConfigured`,
    emits phase "imaging"/"Creating your image" (progress UI is label-driven,
    renders automatically), returns image with placement "top", try/catch
    non-fatal. Called in `generateEmailForTopicStreamed` after
    `renderEmailForContext` (splices + sets `meta.hero_image`); NOT called in
    `regenerateEmailDraft` (first generation only, by design).
  - `lib/pipeline/generate-blog.ts`: calls `maybeAutoHeroImage` with
    `copy.title`, passes hero to `renderBlogPreviewHtml`, sets
    `meta.hero_image`.
- Dark mode COMPLETE, both paths:
  - Template path: `lib/email/templates/shared.ts` `renderShell` emits both
    color-scheme meta tags + `renderDarkModeStyle()` (a neutral `DARK`
    palette; `@media (prefers-color-scheme: dark)` overriding `.em-bg`,
    `.em-card`, `.em-heading`, `.em-lead`, `.em-text`, `.em-muted`,
    `.em-hairline`, `.em-border` with !important — the only way head CSS
    beats inline styles in email). Class hooks across the helpers
    (header wordmark/divider, footer, `renderDivider`, `leadParagraph`) and
    on all three templates' `<h1 data-region="headline">`.
  - Model path: `prompts/email-design.ts` gained the two required meta tags
    in Structure plus a DARK MODE section (stable em-* class names, a
    prefers-color-scheme block with !important, accent/CTA unchanged, never
    invert images, light stays the base); the style-block rule widened to
    "mobile and dark-mode".
  - Blogs: `lib/blog/render-preview.ts` has the color-scheme meta,
    `:root{color-scheme:light dark}`, and a dark `@media` block (dark
    surfaces, light text, tuned post-meta/blockquote).
  - Decision: NO blind code-level meta injector — declaring dark support
    without dark CSS suppresses client auto-inversion and looks worse; both
    real HTML paths carry full support by construction instead.
- Splice logic extracted to `lib/email/hero-image.ts` (pure, NOT
  server-only, same pattern as to-portable-text) so it could be unit-tested;
  `lib/pipeline/generate-image.ts` re-exports it so all existing imports
  stand. 9 tests in `lib/email/hero-image.test.ts` cover every placement,
  the move-not-duplicate property, untagged-document fallbacks, the
  no-anchor null case, and remove round-trips.

**Remaining:**
1. Live browser click-through (Jordan, logged in): add/move/regenerate an
   email image (all three positions), blog "+ Add image", approve → publish
   a blog and confirm the Sanity doc carries `mainImage`, onboarding asks
   the auto-images question, Settings → Visual identity shows the AI images
   toggle, and a generated email/blog renders correctly in dark mode
   (macOS dark appearance, Apple Mail or the preview iframe).
2. Commit this branch when Jordan says so.

## 2026-07-05 session 4 — Connections feature (per-brand MailerLite + Sanity credentials, encrypted)

Implemented the plan `~/.claude/plans/how-does-cosmic-nova.md` end to end.
Lets a user connect their OWN MailerLite/Sanity credentials in Settings →
Connections, stored per-brand encrypted at rest (AES-256-GCM), with the
server env vars remaining as a per-field fallback. All UNCOMMITTED on
`feat/dashboard-create-agent` on top of the session-3 work. `npm run
typecheck`, `npm run build`, and `npx vitest run` (22/22) all green.

**What changed:**
- `lib/crypto/secrets.ts` (NEW) — `encryptSecret`/`decryptSecret`/`isEncryptedSecret`,
  format `gcm:v1:<iv>:<tag>:<ct>` (5 parts when split), lazy-reads
  `INTEGRATION_ENCRYPTION_KEY` (32-byte base64) inside each fn. NOT `import
  "server-only"` on purpose: vitest breaks on it (mirrors `lib/email/hero-image.ts`'s
  stated convention); the boundary holds via callers + the `node:crypto` import.
  3 round-trip tests in `lib/crypto/secrets.test.ts`.
- `lib/db/types.ts` — `BrandIntegration` row type. `lib/db/queries.ts` —
  `getBrandIntegrations`/`getBrandIntegration`/`upsertBrandIntegration`
  (`onConflict: "brand_id,provider_id"`)/`deleteBrandIntegration`. The two
  reads degrade to `[]`/`null` on Postgres `42P01` (undefined_table) so the
  settings page keeps rendering before migration 004 is applied — the
  Connections feature lights up once the table exists.
- `lib/publishing/provider.ts` — `isConfigured(brand, integration)` (was no-arg,
  env-only); `PublishInput.integration`; new `ProviderField` type + `fields`
  on `PublishProvider` (single source of truth for the form + API route).
- `lib/publishing/credentials.ts` (NEW) — `resolveSecret`/`resolvePlain`:
  stored-then-env-fallback per field. `lib/publishing/connections.ts` (NEW) —
  `describeConnection(provider, brand, integration)` → `{state, values,
  secretIsSet}`; the ONE place the form's view-model is computed, used by both
  the settings page and the API route. Never decrypts.
- `lib/clients/sanity.ts` — dropped the pure-env lazy singleton; now
  `resolveSanityConfig(integration): SanityConfig | null` + `getSanity(config)`.
  `isSanityConfigured()`/no-arg `getSanity()`/`SANITY_POST_TYPE` const removed.
- `lib/publishing/providers/{mailerlite,sanity}.ts` — each got a `fields` array;
  `isConfigured` + `publish` resolve via the helpers instead of raw env.
  MailerLite sender stays on `brand.mailerlite_config` (Brand basics); apiKey +
  groupIds live on the connection (groupIds falls back to the legacy brand
  column at publish time).
- `lib/pipeline/publish.ts` — reordered: `getSingleBrand` + `getBrandIntegrations`
  now load BEFORE provider selection (isConfigured needs them); the matching
  `integration` is threaded into `provider.publish`.
- `app/api/settings/connections/route.ts` (NEW) — GET (per-provider view-model,
  never decrypts), PATCH (merge: plain overwrites, secret encrypts only when
  non-empty → "leave blank to keep"), DELETE (query params). Both GET+PATCH
  validate `brandId` against the single brand.
- Settings UI: `connection-form.tsx` (NEW, shared, field-driven; masked secrets
  with "•••• saved — leave blank to keep"; banner by state; Disconnect →
  ConfirmDialog; refetches GET after save/disconnect). `settings-client.tsx`
  `ConnectionStatus` restructured (`state`/`values`/`secretIsSet`/`fields`);
  Connections ListRows now clickable w/ chevron + state subtitle; one Sheet per
  provider. `settings/page.tsx` computes connections via `describeConnection`.
- `app/(dashboard)/drafts/[id]/page.tsx` — blog publish card now resolves Sanity
  reachability from brand+integration (was env-only `isSanityConfigured()`).
- `.env.example` — `INTEGRATION_ENCRYPTION_KEY=` with `openssl rand -base64 32`.

**Plan deviations (intentional, documented above):** (1) `secrets.ts` omits the
literal `import "server-only"` for vitest compatibility (boundary holds by other
means). (2) Added a small `lib/publishing/connections.ts` + made the read
queries migration-resilient — not in the plan, but needed so the live settings
page doesn't break before migration 004 is applied. (3) Dropped the unused
`brand` param from `resolveSanityConfig` (Sanity has no brand-column legacy).

**NOT yet verified live (needs Jordan):**
1. Apply migration 004 (`brand_integrations` table) in the Supabase SQL editor.
2. Generate + set `INTEGRATION_ENCRYPTION_KEY` in `.env.local`
   (`openssl rand -base64 32`).
3. Logged-in browser click-through: Settings → Connections opens each provider's
   sheet; save a fake MailerLite key → banner "Connected via your account";
   disconnect → falls back to "Using server default (.env)"; then one real
   end-to-end publish (email via MailerLite, blog via Sanity) confirming the
   connected credentials resolve. Auth middleware blocks plain curl.

## What's not built yet

- **Live verification of this session's work** — nothing above has run
  against real keys yet: needs `GEMINI_API_KEY` (images), `SANITY_*` (blog
  publish), `MAILERLITE_API_KEY` + verified sender (email publish), and
  **migration 004 applied in the Supabase SQL editor**. Then: generate a
  blog draft end-to-end in the browser, publish twice and confirm the second
  call is a no-op, and generate each image style on a draft.
- **Blog reject/regenerate + click-to-edit for blog drafts** (email has both).
- **Actually sending email campaigns** (adapter creates the MailerLite
  campaign as a draft; the schedule/send call is a future surface).
- **Slice 4 — Keyword research (DataForSEO):** not started; still the
  natural upstream unlock for topic quality.
- **Slice 7 — Distribution/repurposing checklist:** not started.
- **Analytics loop** (`performance` table) — after publishing goes live.
- **Multi-tenancy + RLS (Tier 3)** — deliberately out of scope, the one true
  blocker to selling it as SaaS.
- Topic remap: seeded topics still map to placeholder product slugs
  (see memory `project-pending-product-save`).

## Next step

1. Jordan adds keys to `.env.local` (`GEMINI_API_KEY`; later `SANITY_*` and
   `MAILERLITE_API_KEY`) and applies migration 004 in the Supabase SQL editor.
2. Live-verify per the plan's Verification section: image styles on a real
   draft; blog generate → approve → publish → re-publish no-op; campaign
   chat turn-2 `CACHE HIT` in the `[usage:*]` logs.
3. Commit this branch (it's all uncommitted work on top of `bc842a0`).

## How to verify this doc against reality

This file is written from a point-in-time read of the repo (2026-07-03).
Before trusting a claim above, spot-check it:

- `ls lib/clients/` — confirms which external API clients actually exist.
- `git log --oneline -20` — confirms what's actually been committed.
- `grep -rn "MAILERLITE\|SANITY\|DATAFORSEO" .env.example` — confirms which
  env vars are expected/wired for later slices.
