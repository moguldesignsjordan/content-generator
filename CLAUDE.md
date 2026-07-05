# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An **Automated Content Engine**: a Next.js app that picks a topic from a stored brand strategy, has Claude draft an on-brand email (blog later), routes it through a human approval gate, then publishes to MailerLite (email) and Sanity (blog). One brand for now (Mogul Design Agency), shaped so multi-brand is a later config change, not a rewrite.

## Source-of-truth docs (read these before non-trivial work)

- `automated-content-engine-plan.md` — full architecture and the §7 data model.
- `v1-build-guide.md` — the **vertical-slice build order** and the per-slice specs/guardrails. Work one slice at a time; don't build ahead.
- `brand-strategy-template.md` — the ICP / pillars / hub-and-spoke cluster schema the seed and DB are built around.
- `README.md` — slice roadmap (checkboxes) + setup.
- `PROJECT_STATE.md` — living save/restore state: locked decisions, what's done, what's blocked, next step. Read it to restore context; update it when progress changes.

## Commands

```bash
npm run dev        # dev server (http://localhost:3000)
npm run build      # production build
npm run typecheck  # tsc --noEmit
npm run seed       # load the Mogul Design Agency strategy into Supabase (tsx db/seed.ts)
```

There is **no test framework yet** — verification is `npm run typecheck` + `npm run build`. The two run in CI-less practice as the "does it compile and pass types" gate after each slice.

**Verify UI changes in the real app, not just at the type level.** A green typecheck/build says the code compiles, not that the screen is right. For any change to a page, form, or component, drive the actual flow with the **Playwright MCP** (`playwright` server in `.mcp.json`) against the running dev server at `http://localhost:3000` — start `npm run dev` first if it isn't up. Navigate to the affected route, exercise the flow, and snapshot or screenshot to confirm the result (check both light and dark where the templates support it). Prefer this over guessing from the diff.

## Setup the app needs to actually run

The app degrades gracefully without keys (the dashboard shows a "Connect Supabase" guide instead of crashing), but to run for real:

1. Fill `.env.local` (template in `.env.example`) — at minimum the three `SUPABASE_*` values and `ANTHROPIC_API_KEY`. Other keys are per-slice.
2. Apply `db/schema.sql` in the Supabase SQL editor (it's idempotent — drops then recreates).
3. `npm run seed` to load the brand strategy.

## Architecture

**Strategy is data, not code.** The "marketing brain" lives in Postgres, not constants. The spine is one chain of foreign keys:

```
brands → strategies → icps / pillars → clusters → topics
                                          topics → content_jobs → drafts → approvals → publications → performance
```

`topics` (the hub-and-spoke "spokes") is the **handoff point**: the pipeline reads a topic — which already carries target keyword, intent, funnel stage, internal links, mapped product, and distribution recipe — and writes `status`/`published_url` back. This relational shape (joins + constraints + idempotency keys) is why the stack is Postgres/Supabase, not a document store.

**The generation pipeline** (`lib/pipeline/`) is the engine. Current path (Slice 1):
`GenerateButton` (client) → `POST /api/generate` → `generateEmailForTopic()` → assemble context (`getTopicContext`) → build prompt (`prompts/`) → Claude structured output → persist as `drafts` v1 + `content_jobs` + mark topic `in_progress` (`persistEmailDraft`) → `/drafts/[id]` review screen.

**CTA resolution is the connective tissue:** a topic's `funnel_stage` → `strategy.funnel_definition[stage].cta_type` → `brand.voice_profile.cta_library[cta_type]` (see `prompts/generate-email.ts` `resolveCta`). This is how the right call-to-action is chosen automatically per topic.

**Prompt assembly** lives in `prompts/`: `brand-voice.ts` builds the reusable voice/audience block (so blog generation can reuse it verbatim); `generate-email.ts` adds the email-specific system/user messages and the zod `EmailDraftSchema`.

**DB access** is centralized in `lib/db/`: `client.ts` (server-only Supabase admin client + `isSupabaseConfigured`), `types.ts` (hand-maintained row types — replace with generated types once Supabase is live), `queries.ts` (all reads/writes).

## Git workflow

- **This repo's normal pattern is committing and pushing directly to `main`** — most history (including prior Claude-authored commits) was made this way; feature branches like `feat/dashboard-create-agent` are the exception, not the rule.
- **A regular (non-force) `git push` to `main` or the current branch is pre-authorized** once the user asks to push (e.g. "push this," "push it up") — treat that request as sufficient without asking for extra confirmation first.
- This does **not** extend to force-push, `--no-verify`, rewriting published history, or pushing to a branch/remote the user didn't ask about — those still need explicit per-instance approval per standard git safety practice.

## Conventions and constraints specific to this repo

- **Server-only boundary is enforced, not assumed.** `lib/db/client.ts`, `lib/db/queries.ts`, `lib/clients/anthropic.ts`, and `lib/pipeline/` all import `"server-only"` so secrets (service-role key, Anthropic key) can never reach the client bundle. Keep new secret-touching code behind that boundary.
- **Draft model is `claude-sonnet-4-6`** (`DRAFT_MODEL` in `lib/clients/anthropic.ts`) — the docs specify "Sonnet for drafts, Opus for hard pieces." Don't swap it to the default Opus without reason. Email generation uses structured outputs (`messages.parse` + `zodOutputFormat`) + adaptive thinking.
- **Generation routes set `maxDuration`** (300s on `/api/generate`) — a Claude call with thinking takes 30–90s and exceeds the default serverless timeout.
- **MailerLite requires the `{$unsubscribe}` merge tag.** `lib/pipeline/generate.ts` enforces it on every email so a draft can't be unpublishable; preserve that guarantee.
- **The human-approval gate is mandatory** — nothing publishes without an explicit approve action. No auto-publish.
- **Publishing must be idempotent** (Slice 3+): store the external id on `publications` (the `unique(job_id, target)` constraint backs this) so a retry never double-posts.
- **Sanity stores Portable Text, not HTML/markdown** (Slice 5+): convert and unit-test the conversion; don't write raw markdown into a rich-text field.
- **Verify API shapes against live docs before integrating** a new external API (Anthropic, MailerLite, Sanity, DataForSEO) — don't assume request/response shapes from memory.
- **Path alias:** `@/*` maps to the repo root (`tsconfig.json`).
