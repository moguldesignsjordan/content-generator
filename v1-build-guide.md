# v1 Build Guide — for directing an AI coding agent

**Your setup:** one brand you own · a few pieces a week · built by you directing an AI coding agent (e.g. Claude Code) · email first, blog second.

This guide refines the main plan for *that* reality: it strips v1 down to the simplest thing that works, orders the build into testable slices, and gives you the exact guardrails and prompts to hand your AI agent. Use it alongside `automated-content-engine-plan.md` (architecture) and `brand-strategy-template.md` (the marketing brain).

---

## 1. The big simplification for v1

The main plan recommends a durable workflow engine (Inngest/Trigger.dev). **You don't need it yet.** That's for scheduled, high-volume, multi-brand operation. At a few pieces a week your "pipeline" is just:

> click **Generate** → Claude writes a draft → saved to DB as `in_review` → it shows in your dashboard → you **Approve** → it publishes.

That's normal web-app CRUD with status states. No queues, no background orchestration. Add the workflow engine later (plan Phase 3) only when scheduling/volume justify it.

**Locked v1 stack:** Next.js (App Router) on Vercel · Supabase (Postgres + Auth) · Anthropic Claude API · MailerLite API · Sanity (`@sanity/client`) · DataForSEO (added in a later slice). One brand's strategy stored as DB rows, not hardcoded.

**One real constraint to tell your agent:** generating a full piece with Claude can take 30–90 seconds, which can exceed a serverless function's default timeout. Fix: set the route's `maxDuration` high enough (Vercel allows up to 300s on Pro/Fluid Compute), or run generation as a background route. If this ever gets painful, that's your signal to adopt Inngest/Trigger.dev.

---

## 2. Accounts & keys to gather first (plain-language)

Before the agent writes code, create these and collect the keys (keep them in a password manager, never in code):

- **Anthropic** — API key (console.anthropic.com).
- **MailerLite** — account + API token (Integrations → API).
- **Sanity** — a project (note its **projectId** and **dataset**, usually `production`) + a **write token** (sanity.io/manage → API → Tokens).
- **Supabase** — a project (note the project URL + anon key + service-role key).
- **Vercel** — account for deployment (connect your GitHub repo).
- **DataForSEO** — sign up later, when you reach that slice (free sandbox for testing).

---

## 3. Repo structure (tell the agent to scaffold this)

```
/app
  /(dashboard)        # topic list, draft review screens
  /api                # route handlers (generate, publish) with maxDuration set
/lib
  /clients            # anthropic.ts, mailerlite.ts, sanity.ts, dataforseo.ts
  /pipeline           # generate.ts, qa.ts, publish-email.ts, publish-blog.ts
  /db                 # queries + types
/prompts              # brand-voice.ts, generate-email.ts, generate-blog.ts, qa.ts
/db
  schema.sql          # tables from plan §7
  seed.ts             # seeds ONE brand's strategy from brand-strategy-template
.env.local            # ALL secrets here, server-only, never committed
```

---

## 4. Build it in vertical slices (the right order)

Each slice is shippable and testable on its own. **Do not ask the agent for the whole app at once.** Build, run, and verify one slice before the next. You have a usable email tool by Slice 3.

| Slice | What it delivers | Done when… |
|---|---|---|
| **0 — Scaffold** | Next.js + Supabase wired; `schema.sql` applied; `seed.ts` loads one brand's strategy + a few topics; bare dashboard lists topics | You can see your seeded topics in the browser |
| **1 — Generate email** | "Generate" on a topic calls Claude with brand voice + strategy context; saves a draft (`in_review`); draft viewable | Clicking a topic produces a readable, on-brand email draft |
| **2 — Review gate** | Approve / edit-inline / reject-with-feedback; reject regenerates with feedback in context (cap 2–3) | You can approve, edit, or reject; reject yields a new version |
| **3 — Publish email** | Approved email → MailerLite **draft** campaign (subject, sender, preheader, HTML, group, `{$unsubscribe}`) | The approved email appears as a draft campaign in MailerLite |
| **4 — Keyword research** | DataForSEO step feeds volume/difficulty/intent into the brief before generation | Generated briefs cite real keyword data |
| **5 — Blog path** | Markdown → Portable Text → Sanity **draft** document; image fields optional | An approved post appears as a draft in Sanity Studio |
| **6 — SEO/QA pass** | Second Claude pass: keyword/readability/meta-title/description + banned-claims check | Each draft arrives with meta fields and a QA note |
| **7 — Distribution** | Auto-generate the repurposing checklist from the topic's distribution recipe | Each published piece lists its newsletter/social/internal-link tasks |
| **Later** | Scheduling + calendar (add Inngest), performance pull-back (GSC + MailerLite reports), images, multi-brand | — |

---

## 5. Slice 1 spec in full (hand this to the agent first, after Slice 0)

*Goal:* generate an on-brand email draft from a selected topic.

- **Trigger:** a "Generate email" button on a topic row in the dashboard.
- **Input:** the topic record (title, target_keyword, intent, funnel_stage) + the brand's strategy + voice profile from the DB.
- **Process:** build a prompt that includes (a) the brand voice + 2–3 example posts, (b) the matched-to-funnel CTA, (c) the target keyword and intent, (d) banned words/claims. Call Claude (Sonnet). Return subject, preheader, and HTML body including the `{$unsubscribe}` merge tag.
- **Output:** save a `drafts` row (version 1, state `in_review`) linked to the topic; mark the topic `in_progress`.
- **UI:** show the rendered draft (subject + body) on a review screen.
- **Acceptance criteria:** clicking generate on a topic produces, within the function timeout, a saved draft that reads in the brand's voice, uses the target keyword naturally, ends with the correct CTA, and contains no banned terms.

---

## 6. Guardrails — paste these into the agent's instructions

These are the mistakes AI agents most often make on a build like this. Give them as rules:

1. **Secrets are server-only.** Anthropic, MailerLite, Sanity token, DataForSEO, and Supabase service-role keys live in `.env.local`, are read only in server code, and never reach the client bundle or git. Verify nothing secret is imported into a client component.
2. **Verify API shapes against live docs before integrating.** Fetch and read the current official docs for Anthropic Messages, MailerLite Campaigns, Sanity client mutations, and DataForSEO — do not assume request/response shapes from memory.
3. **Publishing is idempotent.** Store the external ID (MailerLite campaign id, Sanity doc id) on the `publications` row. On any retry, never create a second campaign or post for the same approved draft.
4. **Sanity stores Portable Text, not HTML/markdown.** Implement and unit-test the Markdown→Portable Text conversion (`@portabletext/block-tools` or equivalent). Don't write raw markdown into a Sanity rich-text field.
5. **Every external call has error handling and a visible failure state** in the dashboard. Never silently swallow an API error.
6. **Set `maxDuration`** on generation routes high enough for a 30–90s Claude call, or run generation as a background task.
7. **The human-approval gate is mandatory.** Nothing publishes without an explicit Approve action. No auto-publish in v1.
8. **Brand + strategy are DB data, not hardcoded constants** — one brand now, but shaped so adding brands later is config, not a rewrite.

---

## 7. How to direct the agent (workflow that works)

- **Give it context once:** point it at all three docs (this guide, the architecture plan, the strategy template).
- **Work one slice at a time.** Paste that slice's spec + acceptance criteria. Resist "build everything."
- **Test each slice yourself** before moving on — run it, click the button, confirm the acceptance criteria literally pass.
- **Before any API integration,** tell it: "fetch and read the current official docs for this API first, then implement."
- **When something breaks,** give the agent the actual error text, not a paraphrase.
- **Commit after each working slice** so you can roll back.

---

## 8. Still open (answer when ready)

- **The actual brand.** One or two lines (what it sells, who buys, top competitors) lets me generate its full ICP / pillars / cluster map in the template schema and hand you a ready-to-seed `seed.ts` strategy — turning Slice 0 from a blank into a real starting point.
- **Confirm text-only for v1** (images deferred) and a **lean budget** (DataForSEO is cents at this cadence) — assumed unless you say otherwise.
