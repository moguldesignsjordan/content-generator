# Project State

Living save/restore doc. Read this first to pick up context; update it
whenever progress, blockers, or decisions change. Keep this file short:
implementation detail (file paths, function names, "verified live" blow-by-
blow) belongs in git history and the code itself, not here. `git log
--oneline -20` is the changelog; this file is decisions + current state +
what's genuinely still open.

Last updated: 2026-07-05.

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
- Publishing is built as a provider-agnostic layer (`lib/publishing/`) but
  sending still requires per-brand credentials + an explicit click — nothing
  auto-sends. Adapters create drafts/campaigns on the provider side; the
  actual send/schedule stays a human act.

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

**Known limitations (by design or deferred, not bugs):**
- The SSE generation-run dedupe registry (`lib/pipeline/generation-runs.ts`)
  is in-memory, single-instance only — fine for now, would need a real queue
  for multi-instance hosting.
- Regenerating/redesigning a draft never re-triggers auto-image; only the
  first generation does.
- Seeded topics still map to placeholder product slugs, not real products
  (7 real products are live in Supabase — see memory
  `project-pending-product-save`).

## Not yet verified

Nothing here is blocked on infra (keys/migration/commit are all done) — this
is purely "click through it as the logged-in user":
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

## What's not built yet

- Settings-form UI to pick an email_type/blog_type override per topic/job
  (the backend override path is wired; nothing in the UI sets it yet) or to
  tune per-type word targets.
- Blog reject/regenerate + click-to-edit for blog drafts (email has both).
- Actually sending email campaigns (the adapter creates the MailerLite
  campaign as a draft; scheduling/sending stays a future surface).
- **Slice 4 — Keyword research (DataForSEO):** not started; the natural
  upstream unlock for topic quality.
- **Slice 7 — Distribution/repurposing checklist:** not started.
- **Analytics loop** (`performance` table) — after publishing goes live.
- **Multi-tenancy + RLS (Tier 3)** — deliberately out of scope, the one true
  blocker to selling this as SaaS.
- Topic remap: seeded topics still map to placeholder product slugs.

## Next step

1. Jordan clicks through the "Not yet verified" list above in a logged-in
   browser session.
2. Pick up the next slice (keyword research is the natural next unlock) or
   address anything the click-through turns up.

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
