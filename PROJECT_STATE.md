# Project State

Living save/restore file for the **Automated Content Engine**. Update it as work
progresses; it's the quick-context handoff between sessions. (The `README.md`
holds the canonical slice roadmap and setup — keep the two in sync.)

> To restore context in a new session, point me at this file: "read PROJECT_STATE.md".
> To save progress: "update PROJECT_STATE.md".

_Last updated: 2026-06-26_

## What this is

A Next.js app: pick a topic from a stored brand strategy → Claude drafts an
on-brand email → a human approves → publish to MailerLite (email) / Sanity
(blog). Built in vertical slices per the three planning docs in the repo root
(`automated-content-engine-plan.md`, `v1-build-guide.md`,
`brand-strategy-template.md`).

## Locked decisions (not obvious from code)

- **Brand seeded = Mogul Design Agency** (jordan@moguldesignagency.com). The
  strategy in `db/seed.ts` is a *draft* I inferred — meant to be edited against
  real evidence (customer calls, competitor reviews, GSC data).
- **Stack:** Next.js App Router · Supabase (Postgres) · Anthropic · MailerLite ·
  Sanity · DataForSEO (later slice). All TypeScript. (Settled: Supabase over
  Firebase, and TypeScript over Python, for this app.)
- **Draft model = `claude-sonnet-4-6`** (docs specify "Sonnet for drafts").
  Email generation uses structured outputs (`messages.parse` + zod
  `EmailDraftSchema`) + adaptive thinking.
- **Email format = clean inline-styled HTML** (not MJML). The `{$unsubscribe}`
  MailerLite merge tag is enforced in `lib/pipeline/generate.ts`.

## Progress

- [x] **Slice 0 — Scaffold:** `db/schema.sql` (all plan §7 tables), `db/seed.ts`,
  dashboard topic list, `lib/db`. Verified by typecheck + build.
- [x] **Slice 1 — Generate email:** GenerateButton → `/api/generate` →
  `generateEmailForTopic()` → Claude → saves draft v1 → `/drafts/[id]` review
  screen. Verified by typecheck + `next build` **only**.
- [ ] **Live end-to-end run** — blocked on real keys. Needs `SUPABASE_*` +
  `ANTHROPIC_API_KEY` in `.env.local` (scaffolded with placeholders; no live
  Supabase project yet).

### To unblock the live run
1. Create a Supabase project → paste URL + anon key + service-role key into `.env.local`.
2. Add `ANTHROPIC_API_KEY` to `.env.local`.
3. Run `db/schema.sql` in the Supabase SQL editor.
4. `npm run seed` → `npm run dev` → open http://localhost:3000 → click **Generate email**.

## Next step

**Slice 2 — Review gate:** approve / edit-inline / reject-with-feedback; a
reject regenerates a new draft version with the feedback in context (cap 2–3
loops). See `v1-build-guide.md` §4 and the Slice 2 row in §4's table.

## Open items

- Slices 0–1 are staged in git but not committed (awaiting your go-ahead).
- `db/seed.ts` strategy is a draft to refine against real evidence.
