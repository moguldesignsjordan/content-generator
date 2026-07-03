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
