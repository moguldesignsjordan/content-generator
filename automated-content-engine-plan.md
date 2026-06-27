# Automated Content Engine — Build Plan

A production-ready system that generates SEO-informed email campaigns and blog posts for a brand, with a human approval step, then publishes to **MailerLite** (email) and **Sanity.io** (website). Built so it can later scale into a multi-brand web app.

> **What changed in this version:** added the **Strategy layer** (§3) — the ICP / pillars / topic-cluster brain that decides *what* to write and *why*. This is the part that makes content actually perform, and it's how agencies operate at scale. A concrete, fill-in-the-blanks template lives in the companion doc **`brand-strategy-template.md`**.

---

## 1. What you're actually building

Four layers. The first one is new — and it's the one beginners skip and pros obsess over.

0. **The strategy layer** — the brand's marketing brain: who the customer is (ICP), the themes the brand wants to own (pillars), and the map of topics to write (clusters). This decides *what* the engine makes and *why*. Without it you produce a lot of content nobody reads.
1. **The content pipeline** — the engine. Picks a topic *from the strategy*, does keyword research, drafts in brand voice, runs QA/SEO, waits for human approval, publishes.
2. **The control surface** — a web dashboard to trigger jobs, review/edit/approve drafts, and see performance. Makes it a product, not a script.
3. **Multi-tenancy** — later. Each brand becomes a tenant with its own strategy, MailerLite key, Sanity project, and voice profile.

Build the strategy layer as *data* from day one (it's just structured config), then layer 1 and a thin version of layer 2. Don't build multi-tenancy early — but make the choices below so you don't have to refactor for it.

---

## 2. Recommended stack

| Concern | Recommendation | Why |
|---|---|---|
| Language | **TypeScript end-to-end** | Sanity's client and Next.js are TS-native; avoids a Python/JS split. |
| Web app / dashboard | **Next.js** (App Router) on **Vercel** | First-class Sanity integration, easy auth, scales without ops work. |
| LLM | **Anthropic Claude API** (Sonnet for drafts, Opus for hard pieces) | You're already on Claude; strong long-form writing and tool use. |
| Orchestration | **Inngest** or **Trigger.dev** (durable workflows) | Native support for multi-step jobs, retries, and *pausing for human approval* — the exact pattern you need — without standing up Python/LangGraph. |
| Email | **MailerLite API** | Your chosen provider; clean REST API for campaigns + automations. |
| CMS / blog | **Sanity.io** (`@sanity/client`) | Your chosen CMS; fully writable via API. |
| Keyword/SEO data | **DataForSEO** (primary) + **Google Search Console** (free, your own data) + optional **Serper** (live SERP) | DataForSEO is the developer-first, pay-as-you-go standard; Ahrefs/Semrush gate API access behind expensive tiers. |
| Database | **Postgres** via **Supabase** or **Neon** | Stores strategy, jobs, drafts, brand profiles, audit logs. Supabase also gives you auth. |
| Auth | **Supabase Auth** or **Clerk** | Needed the moment it's a web app; trivial to add early. |
| Secrets | Env vars now; **encrypted per-tenant secrets** in DB later | Multi-tenant means storing each brand's API keys safely. |

**Alternative orchestration:** if you prefer Python, **LangGraph** (v1.0+, the production HITL standard used by Uber, Klarna, LinkedIn) is the heavier-duty choice — durable state, checkpointing, interrupt-and-resume. Use it for complex branching/multi-agent flows. For a single linear pipeline with one approval gate, Inngest/Trigger.dev in TypeScript is lighter and keeps you in one language.

---

## 3. Strategy layer — the part that makes content *work*

This is the difference between "an AI that writes a lot" and "a system that grows a brand." It's how agencies operate: strategy first, production second. It's three structured objects stored per brand.

**A. ICP (Ideal Customer Profile).** A precise picture of who you're writing *for* — their goals, pains, buying triggers, objections, and the actual words they use. Everything downstream (topics, angle, vocabulary, CTAs) is derived from this. You can have 2–3; lead with the primary.

**B. Pillars (3–5).** The themes the brand wants to be *known* for — the territory it's claiming. Each pillar serves a business goal and a stage of the buyer's journey. The common rule: most pillars target awareness/consideration (the big top-of-funnel demand), and exactly one targets the decision stage (why-us / product). Beginners make everything a product pillar, which is why their content gets no traffic.

**C. Topic-cluster map.** Each pillar expands into a **hub-and-spoke cluster**: one broad "pillar/hub" page plus 6–15 specific long-tail "spoke" posts that all link back to the hub. This is the *topic cluster* model agencies use to build topical authority — the hub ranks for the head term, the spokes capture the long tail, and internal links route readers toward products. Every spoke is tagged with target keyword, search intent, funnel stage, internal-link targets, the product it maps to, and its distribution plan.

**How it plugs into the engine:** the strategy object *replaces "type a topic"* as the trigger. A new pipeline **Step 0 (topic selection)** reads the cluster map, checks what's already published (query Sanity) and what's underperforming, and **picks the next topic** — which already carries its pillar, keyword, intent, funnel stage, internal links, and distribution recipe. Every later step inherits that context, so the whole pipeline runs on-strategy by default.

> A full worked example (a real ICP, pillar set, and an expanded cluster map) plus the reusable schema and a "how to fill this in for any brand" process is in **`brand-strategy-template.md`**. Build your strategy config around that schema.

---

## 4. The content pipeline (the core)

An **agentic *workflow***, not an autonomous agent: fixed steps, one human gate. Automates ~80% of the work while keeping a human veto before anything goes live.

```
[Strategy → pick topic] → [Keyword Research] → [Brief] → [Draft] → [SEO/QA self-check]
   → [HUMAN REVIEW: approve / edit / reject] → [Publish] → [Distribute] → [Log + track]
                          ↑__________ reject w/ feedback (max 2–3 loops) ___|
                                                                              ↓
                                                  performance feeds back into Strategy
```

**0. Pick topic (from Strategy).** Engine selects the next topic from the cluster map based on calendar, gaps, and performance. Carries pillar, target keyword, intent, funnel stage, internal-link targets, CTA type, and distribution recipe. (Manual "write about X" still works as an override.)

**1. Keyword research.** Validate/expand the cluster via DataForSEO (volume, difficulty, SERP features); optional Serper to study who ranks now. Confirms 1 primary + 2–4 secondary keywords and intent.

**2. Brief.** Assemble the brief: keyword, intent, outline, internal-link targets (query Sanity for related posts), word count, and the **CTA matched to the funnel stage** (awareness → subscribe; consideration → product collection; decision → buy/trial). Optional web-search pass for fresh, sourced facts.

**3. Draft.** Claude generates using the **brand + strategy profile** (§5). Blog → Markdown (convert to Portable Text at publish — see §6). Email → responsive HTML via **MJML** or clean inline-styled HTML, including the `{$unsubscribe}` merge tag MailerLite requires.

**4. SEO/QA self-check.** A second Claude pass critiques the draft: keyword usage/placement, readability, meta title (<60 chars) + description (<155 chars), hallucination flags, and brand-voice/banned-claims compliance.

**5. Human review (the gate).** Draft surfaces in the dashboard. Reviewer can **approve / edit inline / reject with feedback**. Rejection loops back to step 3 *with the draft + specific feedback in context*. Cap at 2–3 loops, then escalate to manual. The workflow engine pauses durably — minutes or days, no resources held.

**6. Publish.** Blog → Sanity: Markdown→Portable Text, upload images as assets, create document (`drafts.` prefix to stage, or publish; wrap multi-step writes in a transaction). Email → MailerLite: `regular` campaign with subject, sender (real domain, not `no-reply@`), preheader, HTML, recipient groups — saved as **draft** for a human send, or scheduled.

**7. Distribute (the multiplier).** Auto-generate the repurposing checklist from the topic's distribution recipe: the newsletter section, N social snippets, and internal links to add from older posts. This is "create once, distribute everywhere" — the agency move beginners skip.

**8. Log + track.** Record inputs, keyword, versions, approvals, publish IDs to Postgres. Pull performance back: GSC impressions/clicks for blog, MailerLite open/click reports for email — feeding the strategy layer's topic-selection ("what's working").

---

## 5. The brand + strategy profile (don't skip this)

The biggest quality lever. Structured config per brand, in the DB, injected into every prompt:

- **Strategy object** (§3): ICP(s), pillars, cluster map, funnel→CTA definitions. *This is the new, most important part.*
- **Voice & tone** (e.g. "confident, plain-spoken, no jargon"), with 2–3 example posts that exemplify it.
- **Banned words / claims / topics** (compliance and brand safety).
- **CTA library** keyed by funnel stage, plus standard links.
- **Email identity:** sender name, sender email, MailerLite group/segment IDs.
- **Blog config:** Sanity project ID, dataset, document type, author reference.
- **SEO defaults:** target geography/language, preferred keyword-difficulty range.

---

## 6. Integration specifics & known gotchas

**Sanity — Portable Text conversion.** Sanity stores rich content as **Portable Text** (structured JSON), not HTML/markdown. You must convert — use `@portabletext/block-tools` / `@sanity/block-tools` / an HTML-to-blocks helper. Budget real time; it's the most common surprise. Schema validation runs only in Studio, **not** on API writes, so validate yourself.

**Sanity — draft vs. publish.** Prefix `_id` with `drafts.` to stage; create/replace without it to publish. Maps cleanly onto your approval gate.

**MailerLite — campaign mechanics.** A `regular` campaign needs content, sender info, and a language ID. An `RSS` campaign type auto-sends new blog posts from a feed — a cheap "new post → email" wire once your Sanity blog exposes RSS. Pull `subscriber-activity` reports for the feedback loop.

**DataForSEO — cost control.** Use the **Standard** (batch) queue, not **Live** (~3.3× cost). Basic Auth (email/password), not OAuth; returns raw JSON. Free sandbox for dev.

**Pipeline correctness.** Make publish steps **idempotent** (deterministic IDs / dedupe keys) so retries never double-post. Keep human-approval a hard gate — never auto-publish brand content.

---

## 7. Data model (starter)

- **brands** — id, name, voice_profile (JSON), sanity_config, mailerlite_config, seo_defaults.
- **strategies** — id, brand_id, funnel_definition (JSON), updated_at. *(one current strategy per brand)*
- **icps** — id, strategy_id, label, profile (JSON: demographics, values, jtbd, pains, triggers, objections, vocabulary, awareness_stage).
- **pillars** — id, strategy_id, name, description, business_goal, primary_funnel_stage, target_icp_id.
- **clusters** — id, pillar_id, hub_title, hub_keyword, hub_intent.
- **topics** — id, cluster_id, title, target_keyword, intent, funnel_stage, internal_link_targets (JSON), maps_to_product, distribution_recipe (JSON), status (idea|queued|in_progress|published), published_url.
- **content_jobs** — id, brand_id, topic_id, type (email|blog), status, trigger_source, created_at.
- **drafts** — id, job_id, version, content, meta (title/description), seo_data (JSON), state.
- **approvals** — id, draft_id, reviewer, decision, feedback, timestamp.
- **publications** — id, job_id, target (sanity|mailerlite), external_id, url, published_at.
- **performance** — id, publication_id, metric, value, fetched_at.
- (later) **tenants / users / api_credentials** (encrypted) for multi-brand.

The `topics` table is the join between strategy and production — the pipeline reads from it and writes status back to it.

---

## 8. Phased roadmap

**Phase 0 — Foundations (days).** Repo, Next.js app, Supabase/Postgres, env secrets. One Claude call + one keyword lookup working in isolation.

**Phase 0.5 — Strategy setup (new).** Build the strategy tables and a simple form/JSON editor to author an ICP, pillars, and a cluster map for one real brand (use `brand-strategy-template.md`). You can even use Claude to *draft* the strategy from a brand description, then edit. This is fast and unblocks everything aimed correctly.

**Phase 1 — Email MVP (your stated first goal).** Topic (from strategy) → keyword research → draft email → QA → review in a basic dashboard → MailerLite **draft** campaign. Ship it; use it for real.

**Phase 2 — Blog.** Sanity path: Markdown→Portable Text, image assets, draft/publish. Internal-linking from the cluster map + existing Sanity posts. Optional blog-RSS→MailerLite loop.

**Phase 3 — Real workflow + scheduling + distribution.** Move orchestration to Inngest/Trigger.dev (durable steps, retries, pause-for-approval). Content calendar + scheduled triggers. Add the distribution/repurposing step and performance pull-back (GSC + MailerLite).

**Phase 4 — Web app hardening.** Auth, roles (creator/approver), audit logs, rate limiting, per-job cost tracking.

**Phase 5 — Multi-tenant SaaS.** Isolated, encrypted per-brand credentials; usage metering/billing; onboarding to connect a brand's MailerLite + Sanity and generate its starter strategy.

---

## 9. Rough monthly cost (single brand, low volume)

- **Anthropic API** — pay per token; a few dollars to low tens depending on volume and Opus/Sonnet mix.
- **DataForSEO** — pay-as-you-go; cents per task, typically single-digit dollars at this scale.
- **MailerLite** — free tier to start; paid from ~$10+/mo as your list grows.
- **Sanity** — generous free tier; usage-based above it.
- **Vercel / Supabase / Inngest** — free tiers cover an MVP.

An MVP runs near-free plus LLM and keyword usage. Costs scale with volume and tenants, not idle time.

---

## 10. Key decisions before you start coding

1. **Orchestration:** TS + Inngest/Trigger.dev (recommended) vs. Python + LangGraph.
2. **Autonomy:** human-approval gate mandatory for v1 (recommended) vs. auto-publish for low-risk content later.
3. **Email format:** MJML (responsive, more setup) vs. inline-styled HTML (simpler).
4. **Keyword depth for v1:** DataForSEO only vs. + Serper live SERP.
5. **Strategy authoring:** hand-write the first strategy vs. have Claude draft it from a brand brief, then edit. (Recommended: draft-then-edit — far faster, and it teaches you the shape.)
6. **Single-brand config vs. strategy-in-DB from day one** — do the DB version early; it costs little and saves a painful refactor before Phase 5.

---

*Research basis: MailerLite Developers API docs; Sanity.io client & Content Lake docs (mutations, Portable Text, drafts); 2025–2026 SEO API comparisons (DataForSEO/Ahrefs/Semrush/Serper); production guidance on human-in-the-loop agentic workflows (LangGraph 1.0, Inngest/Trigger.dev); and standard agency practice for ICP / content pillars / topic-cluster (hub-and-spoke) SEO.*
