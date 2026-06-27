# Content Engine

Automated, on-strategy content for one brand (Mogul Design Agency), with a human
approval gate, publishing to MailerLite (email) and Sanity (blog).

Built in vertical slices — see `v1-build-guide.md` §4. Currently at **Slice 0**.

- Architecture: `automated-content-engine-plan.md`
- The marketing brain (ICP / pillars / clusters): `brand-strategy-template.md`
- How to direct the build: `v1-build-guide.md`

## Stack

Next.js (App Router) · Supabase (Postgres) · Anthropic Claude · MailerLite ·
Sanity · DataForSEO. TypeScript end-to-end. Strategy lives as DB rows, not code.

## Setup (Slice 0)

1. **Install deps** (already done): `npm install`
2. **Create a Supabase project** → Project Settings → API.
3. **Fill `.env.local`** with the three `SUPABASE_*` values (template in `.env.example`).
   Secrets are server-only and git-ignored — never commit them.
4. **Apply the schema:** paste `db/schema.sql` into the Supabase SQL editor and run it.
5. **Seed the brand:** `npm run seed`
6. **Run it:** `npm run dev` → open http://localhost:3000

Until step 3 is done the dashboard shows a "Connect Supabase" guide instead of crashing.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the dev server |
| `npm run build` | Production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run seed` | Seed the Mogul Design Agency strategy into Supabase |

## Layout

```
app/(dashboard)   dashboard screens (topic list now; review/approve later)
app/api           route handlers (generate, publish) — added from Slice 1
lib/clients       anthropic / mailerlite / sanity / dataforseo — added per slice
lib/pipeline      generate / qa / publish — added per slice
lib/db            Supabase client, row types, queries
prompts           brand-voice / generate / qa prompts — added from Slice 1
db/schema.sql     all tables (plan §7)
db/seed.ts        seeds one brand's strategy
```

## Slice roadmap

- [x] **0 — Scaffold:** schema + seed + dashboard topic list
- [ ] **1 — Generate email:** Claude drafts an on-brand email from a topic
- [ ] **2 — Review gate:** approve / edit / reject-with-feedback (regenerate)
- [ ] **3 — Publish email:** approved draft → MailerLite draft campaign
- [ ] **4 — Keyword research:** DataForSEO feeds the brief
- [ ] **5 — Blog path:** Markdown → Portable Text → Sanity draft
- [ ] **6 — SEO/QA pass:** second Claude pass adds meta + checks
- [ ] **7 — Distribution:** repurposing checklist from the topic recipe
# content-generator
