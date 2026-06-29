# Mogul Content Engine — Native-Mobile SaaS Redesign

## Context

The app today is a bare, dark, max-w-3xl form-stack with no navigation chrome, no auth, and **stale placeholder branding** (slate/blue `#0F172A`/`#2563EB` in the seed). Jordan wants it to feel like a real SaaS that a non-technical person can use: a login page, a proper dashboard (emails, drafts, settings), and the AI chatbot promoted to the **main tool** on the dashboard.

The just-supplied **Mogul Brand Guidelines** redefine the look entirely: "Bold spectrum, hard contrast, zero noise" — a dark, Ink-black UI with a single signature spectrum gradient, pill buttons, generous radii, hairline borders, and the Clash/Hanken Grotesk type system. The target style is **mobile-first, native (SwiftUI-like)** — bottom tab bar, large titles, sheets, grouped list rows — that **responsively adapts** to a wider layout on desktop.

Decisions locked with Jordan:
- **Auth:** real Supabase Auth (login gates the app). Data stays single-tenant via the existing service-role client; per-user RLS is a later layer.
- **Layout:** mobile-native on phones, expands to sidebar/wider columns on desktop.
- **Chatbot:** a general **content assistant** on the Home tab (generate/help); onboarding chat stays separate for first-run.

Outcome: a branded, native-feeling, logged-in SaaS where the assistant drives content creation and emails/drafts/settings are first-class tabs.

---

## Brand tokens (authoritative — from the PDF, replaces the seed's stale values)

| Role | Value |
|------|-------|
| Spectral primaries | Solar Amber `#FFAE3C` · Hot Magenta `#FF3D8C` · Electric Violet `#9E4DF2` · Sky Cyan `#1EB4FF` |
| Neutrals | Ink `#08080A` · Carbon `#161618` · Slate `#3A3A40` · Ash `#8A8A94` · Mist `#D8D8DC` · Paper `#FAFAF8` |
| Signature gradient | `linear-gradient(115deg, #FFAE3C 0%, #FF3D8C 38%, #9E4DF2 68%, #1EB4FF 100%)` — **one gradient action per view** |
| Primary interactive / focus ring | Hot Magenta `#FF3D8C` |
| Type | **Clash Grotesk** (display) + **Hanken Grotesk** (body); scale Display 64 / Heading 34 / Body 18 / Caption 13 |
| Shape | Pill buttons (radius 100px, pad 14/28), generous card radii (16–24px), 1px hairline borders on dark |
| Voice | Confident, never loud. Direct, capable, electric. No jargon. (already enforced via `stripEmDashes` / banned terms) |

Logo asset exists at `Mogul Assets/mdalogo.jpeg` (DB `visual_identity.logo_url` is empty).

---

## Plan

### 1. Design tokens + fonts (foundation)
- **`app/globals.css`**: repoint the existing CSS vars to Mogul values (keeps every `bg-background`/`text-foreground`/`bg-accent` class working with zero per-component churn), then add new tokens:
  - `--background: #08080A` (Ink), `--surface: #161618` (Carbon), `--border: rgba(255,255,255,0.08)` (hairline), `--foreground: #FAFAF8`, `--muted: #8A8A94` (Ash), `--accent: #FF3D8C` (Hot Magenta).
  - Add spectral hues (`--amber/--magenta/--violet/--cyan`) and `--spectrum` gradient to the `@theme inline` block so we get `bg-spectrum`, `text-amber`, etc.
  - Native touches: `--radius-card`, momentum scroll, `-webkit-tap-highlight-color: transparent`, safe-area padding vars (`env(safe-area-inset-bottom)`).
- **Fonts**: load **Hanken Grotesk** via `next/font/google` in `app/layout.tsx`; load **Clash Grotesk** (not on Google Fonts) via a Fontshare `@import` placed **above** `@import "tailwindcss"` in globals.css. Wire `--font-display` (Clash) and body font (Hanken) into `@theme`.
- **`app/layout.tsx`**: apply font variables to `<html>`, update metadata (title "Mogul", theme-color Ink), add `viewport` with `viewport-fit=cover`.

### 2. Auth (real Supabase Auth)
- Add dependency **`@supabase/ssr`** (cookie-based SSR auth for App Router).
- New `lib/supabase/server.ts` + `lib/supabase/client.ts` (anon-key clients bound to cookies) — kept distinct from the existing service-role `lib/db/client.ts`, which continues to power data queries (single-tenant).
- **`middleware.ts`** at repo root: refresh session + redirect unauthenticated users to `/login` (allowlist `/login`, `/auth/*`, static assets).
- New route group **`app/(auth)/login/page.tsx`**: Mogul-branded login (email/password + magic-link option), gradient primary button, Hot Magenta focus ring, the bulb-M logo. `app/auth/callback/route.ts` for the magic-link/OAuth exchange.
- Sign-out server action surfaced in Settings.
- Note: gating is app-wide; the single brand is shared by any authed user for now. Document RLS/multi-tenant as future (matches `lib/db/client.ts` comment).

### 3. Native app shell (responsive)
- New **`app/(dashboard)/layout.tsx`** wrapping all dashboard routes:
  - **Mobile:** fixed **bottom tab bar** (Home · Emails · Create · Settings) with safe-area padding; per-screen **large title** header that collapses on scroll.
  - **Desktop (`md+`):** tab bar becomes a left **sidebar**, content expands into a centered wider column / two-pane where it helps. Same components, responsive classes — not a phone frame.
- New components under `app/(dashboard)/_components/`: `app-shell.tsx`, `tab-bar.tsx` (active-state with spectral accent), `screen-header.tsx` (large title), `top-bar.tsx` (logo + account).

### 4. Reusable native UI kit
New `components/ui/` primitives so every screen is built from the same tokens (mirrors the PDF's §06):
- `Button` (variants: `gradient` primary pill, `outline`, `text`; enforces one-gradient-per-view by convention), `Card`, `Badge`/`Pill` (12%-tint spectral), `ListRow` + `ListGroup` (iOS grouped-list feel with chevrons), `SegmentedControl`, `Sheet`/`Modal` (slide-up on mobile), `Field`/`Input` (magenta caret + focus ring), `StatCard` (gradient numerals), `Spinner`.
- Refactor existing `topic-badges.tsx`, `list-input.tsx`, `suggest-button.tsx` to use these primitives.

### 5. Home tab — the content assistant as the main tool
- Redesign **`app/(dashboard)/page.tsx`**: top = greeting + 2–3 `StatCard`s (drafts in review, published, topics ready); center = the **Assistant**; below = "Recent emails" list (links into Emails tab).
- New **`app/(dashboard)/_components/assistant.tsx`**: generalize the existing `chat.tsx` UI (bubbles, typing dots, autoscroll) into a reusable chat that posts to a configurable endpoint, restyled native (gradient send pill, rounded composer, sticky bottom).
- New **`app/api/assistant/chat/route.ts`** + **`prompts/assistant.ts`**: Claude (Sonnet `DRAFT_MODEL`) with brand context + a `generate_email` tool that reuses the existing pipeline `generateEmailForTopic()` (`lib/pipeline/generate.ts`) — the assistant can list topics, kick off a draft, and answer brand/content questions, then deep-link to the new draft. (Conversational help + generation tool in scope; richer tools are follow-ups.)
- Keep onboarding chat (`/onboarding`) separate; restyle it with the new kit. Dashboard still shows the soft "finish setup" banner when `onboarding_state.completed !== true`.

### 6. Emails / Drafts tab
- New **`app/(dashboard)/emails/page.tsx`**: grouped list of every created email (status pills: In review / Approved / Rejected / Published), newest first, with topic title + subject + version. Tapping opens the draft.
- New query **`listDrafts()`** in `lib/db/queries.ts` joining `content_jobs` + `drafts` + `topics` (the dashboard currently only exposes `latestDraftByTopic` via `getBrandStrategy`; no flat list exists). Returns id, topic title, subject (`content.subject`), state, version, created_at.
- Redesign **`app/(dashboard)/drafts/[id]/page.tsx`** + `review-actions.tsx` as a native review screen: rendered email preview card, large title, approve = gradient pill, reject/edit in a slide-up sheet, QA results as grouped rows.

### 7. Create tab + Settings tab
- **Create**: native screen wrapping the existing topic picker (`quick-generate.tsx`) + the strategy tree (`cluster-card.tsx`) restyled as grouped lists with inline add/edit in sheets.
- **Settings**: convert the 6 forms into an iOS-style **grouped settings list** (Brand basics · Voice · Positioning · Visual identity · ICP · Funnel), each opening a detail screen/sheet reusing the existing form components (restyled). Add **Account** group with sign-out. Keep "✨ Suggest with AI" (`suggest-button.tsx`) behavior intact (suggest never persists; Save is the only write).

### 8. Logo
- Copy `Mogul Assets/mdalogo.jpeg` into `public/` for immediate UI use (top bar, login, onboarding). Optionally also upload to the Supabase `logos` bucket and set `visual_identity.logo_url` so generated emails get the real mark (bucket creation still pending from prior session).

---

## Critical files

**Create:** `middleware.ts`, `lib/supabase/{server,client}.ts`, `app/(auth)/login/page.tsx`, `app/auth/callback/route.ts`, `app/(dashboard)/layout.tsx`, `app/(dashboard)/_components/{app-shell,tab-bar,screen-header,top-bar,assistant}.tsx`, `app/(dashboard)/emails/page.tsx`, `app/api/assistant/chat/route.ts`, `prompts/assistant.ts`, `components/ui/*`, `public/mogul-logo.jpeg`.

**Modify:** `app/globals.css`, `app/layout.tsx`, `app/(dashboard)/page.tsx`, `app/(dashboard)/drafts/[id]/page.tsx` + `_components/review-actions.tsx`, `app/(dashboard)/settings/page.tsx` + all `settings/_components/*`, `app/(dashboard)/_components/{cluster-card,quick-generate,generate-button,topic-badges}.tsx`, `app/(dashboard)/onboarding/_components/chat.tsx`, `lib/db/queries.ts` (add `listDrafts()`), `package.json` (add `@supabase/ssr`).

**Reuse (don't rebuild):** `generateEmailForTopic()` (`lib/pipeline/generate.ts`), existing draft queries (`persistEmailDraft`, `approveDraft`, `rejectDraftRecord`, `getDraftForReview`), settings update queries, the onboarding chat tool pattern, `resolveBrandTokens`/email templates, `stripEmDashes` (`lib/text.ts`).

---

## Verification

1. `npm run typecheck` && `npm run build` — the standing gate (no test framework).
2. `npm run dev`, open at a mobile viewport (DevTools iPhone) **and** desktop:
   - `/login` renders branded; unauthenticated access to `/` redirects to `/login`; after login you land on Home.
   - Bottom tab bar (mobile) / sidebar (desktop) navigates Home · Emails · Create · Settings; large titles + safe-area look native.
   - Home assistant: send a message → reply; ask it to generate an email for a topic → new draft appears and deep-links.
   - Emails tab lists drafts with correct status pills; opening one shows the native review screen; approve/reject works.
   - Settings grouped list opens each form; Save persists; "✨ Suggest" still non-destructive; sign-out works.
3. Spot-check brand fidelity: Ink background, exactly one gradient action per screen, Hot Magenta focus rings, Clash headings / Hanken body, pill buttons, hairline borders.
