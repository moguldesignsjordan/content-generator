# Content Engine

Automated, on-strategy content for one brand (Mogul Design Agency), with a human
approval gate, publishing to MailerLite (email) and Sanity (blog).

Built in vertical slices — see `v1-build-guide.md` §4. Slices 0–2 (scaffold,
email generation, review gate) are done; a native-app-style UI overhaul and
Supabase Auth have since been layered on top (see `UI-REDESIGN-PLAN.md`).
Publishing (Slice 3+) has not started yet. See `PROJECT_STATE.md` for the
current save/restore state.

- Architecture: `automated-content-engine-plan.md`
- The marketing brain (ICP / pillars / clusters): `brand-strategy-template.md`
- How to direct the build: `v1-build-guide.md`
- UI redesign spec (mostly implemented): `UI-REDESIGN-PLAN.md`
- Living state: `PROJECT_STATE.md`

## Stack

Next.js (App Router) · Supabase (Postgres + Auth) · Anthropic Claude ·
MailerLite (planned) · Sanity (planned) · DataForSEO (planned). TypeScript
end-to-end. Tailwind v4 with a custom "Bold spectrum" dark design system.
Strategy lives as DB rows, not code.

## Setup

1. **Install deps** (already done): `npm install`
2. **Create a Supabase project** → Project Settings → API.
3. **Fill `.env.local`** with the `SUPABASE_*` values and `ANTHROPIC_API_KEY`
   (template in `.env.example`). Secrets are server-only and git-ignored —
   never commit them.
4. **Apply the schema:** paste `db/schema.sql` into the Supabase SQL editor
   and run it, then apply any files under `db/migrations/` in order.
5. **Seed the brand:** `npm run seed`
6. **Enable Supabase Auth** and create a login for yourself — `/` now
   redirects unauthenticated visitors to `/login` (see `middleware.ts`).
7. **Run it:** `npm run dev` → open http://localhost:3000

Until step 3 is done the dashboard shows a "Connect Supabase" guide instead
of crashing.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the dev server |
| `npm run build` | Production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run seed` | Seed the Mogul Design Agency strategy into Supabase |

There is no test framework yet — `npm run typecheck` + `npm run build` is
the verification gate after each change.

## Layout

```
app/(auth)/login        Supabase-Auth login screen
app/auth/callback       magic-link / OAuth exchange route
app/(dashboard)         native-app-shell dashboard: Home, Emails, Create,
                         Settings, Onboarding (tab bar on mobile, sidebar
                         on desktop — see app/(dashboard)/layout.tsx)
app/(dashboard)/drafts/[id]   draft review screen (approve/edit/reject)
app/api                 route handlers: generate, drafts, topics, brands,
                         settings/*, assistant/chat, onboarding/chat
lib/clients              anthropic.ts — only external API client wired up so far
lib/pipeline             generate.ts, constants.ts — email generation pipeline
lib/db                   Supabase (service-role) client, row types, queries
lib/supabase             cookie-based SSR client/server/middleware for Auth
                          (distinct from lib/db's service-role client)
prompts                  brand-voice / generate-email / qa-email / assistant /
                          onboarding / suggest prompts
components/ui            native UI kit (Button, Card, Sheet, ListRow, etc.)
db/schema.sql            all tables (plan §7)
db/migrations            incremental schema changes applied after schema.sql
db/seed.ts               seeds one brand's strategy
```

## Slice roadmap

- [x] **0 — Scaffold:** schema + seed + dashboard topic list
- [x] **1 — Generate email:** Claude drafts an on-brand email from a topic
- [x] **2 — Review gate:** approve / edit / reject-with-feedback (regenerate)
- [ ] **3 — Publish email:** approved draft → MailerLite draft campaign
- [ ] **4 — Keyword research:** DataForSEO feeds the brief
- [ ] **5 — Blog path:** Markdown → Portable Text → Sanity draft
- [ ] **6 — SEO/QA pass:** second Claude pass adds meta + checks
- [ ] **7 — Distribution:** repurposing checklist from the topic recipe

## Beyond the original slice plan

Built on top of the slice roadmap, not part of it:

- **Supabase Auth** — real login gating the whole app (`middleware.ts`,
  `lib/supabase/`), single-tenant behind the existing service-role client.
- **Native-app-style dashboard shell** — bottom tab bar on mobile, sidebar on
  desktop, large titles, sheets; Mogul's "Bold spectrum" dark brand system
  (Ink/Carbon neutrals, one spectral gradient per view, Clash + Hanken
  Grotesk). See `UI-REDESIGN-PLAN.md` and `app/globals.css`.
- **Content assistant** (`app/(dashboard)/_components/assistant.tsx`,
  `app/api/assistant/chat/route.ts`) — a chat on the Home tab that answers
  brand questions and can call a `generate_email` tool to kick off a draft
  from the existing pipeline.
- **Onboarding chat** (`/onboarding`) — separate first-run conversational
  flow for setting up the brand strategy, backed by `app/api/onboarding/chat`.
- **Settings** — grouped forms for brand basics, brand voice, positioning,
  visual identity (logo upload), ICP, and funnel, each with an "✨ Suggest
  with AI" assist that never persists on its own.
- **Emails tab** — flat list of every draft across all topics with status
  pills, via `listDrafts()` in `lib/db/queries.ts`.
- **Import from website** — paste a URL in Settings → Import from website (or
  when creating a brand in onboarding) and `lib/scrape/` + Claude extract a
  brand proposal: voice, positioning, products, and visual identity (logo,
  colors, fonts). Everything is reviewed and explicitly saved through the
  existing settings routes; the import itself never writes to the DB.
  JS-rendered sites are handled by a headless-Chrome fallback (puppeteer-core
  + your installed Chrome; set `CHROME_EXECUTABLE_PATH` on serverless).
