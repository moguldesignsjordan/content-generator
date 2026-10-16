# Project State

Living save/restore doc. Read this first to pick up context; update it
whenever progress, blockers, or decisions change. Keep this file short:
implementation detail (file paths, function names, "verified live" blow-by-
blow) belongs in git history and the code itself, not here. `git log
--oneline -20` is the changelog; this file is decisions + current state +
what's genuinely still open. When a session ends, edit the sections below
rather than appending a new session log.

Last updated: 2026-10-16. `git status` and `git log` show what's committed
and pushed. Trimmed from a 1,700-line session log; the old entries are in
git history (`git log -p PROJECT_STATE.md`).

## Locked decisions

- One brand UI for now (Mogul Design Agency), with billing and per-brand data
  already multi-tenant. Full per-user RLS is still deferred
  (`multi-tenancy-roadmap.md`).
- Strategy is data (Postgres rows), not code: see
  `automated-content-engine-plan.md` §7.
- Models (`lib/clients/model-ids.ts`): `DRAFT_MODEL` = `claude-sonnet-5`,
  `HARD_MODEL` = `claude-opus-5`, `FAST_MODEL` = Haiku 4.5. Emails use no Opus
  by default; the Opus design critique is opt-in per brand.
- Images: default Nano Banana 2.1, Pro tier available. GPT Image 2.5 shows up
  only when `OPENAI_API_KEY` is set.
- The human-approval gate is mandatory. Nothing publishes without an explicit
  approve plus publish click. The one MailerLite click sends or schedules for
  real (Jordan's call, 2026-07-05). Approved blogs publish live to Sanity
  (Jordan's call, 2026-10-11).
- MailerLite emails always carry `{$unsubscribe}` (enforced in
  `lib/pipeline/generate.ts`).
- Server-only boundary is enforced (`server-only` import) on DB, Anthropic,
  and pipeline code.
- No em dashes or en dashes in any generated or written copy.
- AI proposes, the human approves: brand-brain writes only happen on an
  explicit Save.
- Publishing is a provider layer (`lib/publishing/`), idempotent per job +
  target.
- Web research in campaigns only runs when the owner says yes (enforced in
  code, not just the prompt). The Create chat is different: it searches and
  fetches on its own whenever context helps, capped at 3 searches and 2
  fetches per model call (Jordan's call, 2026-10-15).
- Competitor ads (Jordan's call, 2026-10-16): the writers get the ad's
  distilled strategy plus its saved wording as a suggestion (borrow phrasing,
  never their brand, prices, claims, numbers, or whole lines). Ads ticked in
  the chat become the flyer and ad style by default, in the brand's colors and
  logo; the look picker switches back to Our style. A campaign's planner
  marks about a third of the pieces to follow the ad.
- Create chat questions (Jordan's call, 2026-10-16): follow-ups are one
  question card (up to 3 questions, each with its own tap answers, one Send;
  typing still works). A set of one kind for several products (flyers for
  cards, door hangers, banners) goes through the plan screen first. Per
  product size is asked: 1 each (a one-off) / 3 each / 6 each. Saved ads
  picked in the style pop-up shape look and wording. Products come from both
  a website scraper and the chat. Plan:
  `~/.claude/plans/inherited-knitting-blossom.md`; Parts 1 (the checklist)
  and 2 (one design per product: the planner tags each row with its product,
  code enforces the count per product, max 20), and 3 (saved ads in the
  chat's style pop-up, plus "+ From Ad Library" inside it; a pick replaces
  earlier ads and style images), and 4 (products from the website: sitemaps,
  shop subdomains, Shopify, JSON-LD then Open Graph, text extraction as the
  fallback; photos copied into our storage on save; the chat shows the same
  tick list for "all our products" and the plan offers to save typed ones)
  are all built. None of it has run against a live chat yet (item 1 below).
- Images and inputs (Jordan's call, 2026-10-16): every image attached in the
  chat is labeled by the owner, "In picture" (shown exactly as it looks) or
  "Style" (a design to follow). Photos, style, and competitor ads travel as
  one `inputs` object through every handoff (`lib/inputs.ts`), snapshotted on
  each draft. The first photo leads (an email's or blog's top image, as-is;
  the rest go in the email body). A flyer option or campaign piece shows one
  or several photos, picked by the copy writer or planner, which see them.
  Every writer gets the same brand context (guidelines, voice, positioning,
  learned memory) and the same brief block.
- Flyers (Jordan's call, 2026-10-15, replaces "code sets the text"): every
  option is designed by the image model, following a look or attached design,
  or with No reference a preset direction per option. Haiku reads the text
  back; a design fails only on a missing or misspelled line, a word pair
  copied from the examples, or more than about 8 extra words. One retry, then
  the code-set layout. A showcased designed item (sign, card, packaging) may
  carry made-up sample text (copy field `mockup`).
- Everything made is for the account's own brand (Jordan, 2026-10-15): the
  chat no longer sets `client_brand`; that plumbing is now unused.
- Campaigns: the planner picks one `flyer_style` for all posts and ads, and
  each campaign post renders 2 options (`CAMPAIGN_FLYER_OPTIONS`).
- Flyer styles (Jordan's call, 2026-10-15): "Our style" always follows
  reference images (the default look, else approved or thumbs-up flyers,
  stored as `look_id: "house"`). When it has none, the chat says so and asks
  for examples instead of falling back. "No reference" (`"none"`) is the AI's
  free pick, a fresh preset per option. Uploaded "flyers" in the media
  library are not used: they're often raw photos.
- Flyer references and client brands (Jordan's call, 2026-10-15): a design
  attached in the Create chat to match is sent to the image model as an
  image (the designed-flyer path), never summarized into text, and it skips
  the Our style gate. Option 1 follows it closely; options 2 to 4 keep its
  style and change the composition. It's one-off; the chat offers to save it
  as a look. A flyer for another business uses that business's colors and
  logo (from an attached logo or card); if neither is known the chat asks.
  The account brand's logo is never stamped on a client's flyer. Saved looks
  and Our style also give 1 close + 3 variations. A look's extra text spots
  (date pills, footer bars) are read into the profile and filled by the copy
  step from real facts only; any spot left empty is dropped from the design,
  so the image model has nothing to invent. Campaigns from the chat carry
  attached designs and the client brand to their posts and ads (the design is
  read once, during planning); their emails and blogs stay on our brand.

## Current state

- **Create (`/`) is one chat.** Kind tiles (Flyer, Email, Campaign, Blog post, Ad)
  then the owner describes it; Claude reflects the details back, asks what's
  still open as one question card (up to 3, tap or type), and confirms. The
  code owns the checklist (`lib/create-questions.ts`): what's open per kind,
  what was asked (`brief.asked`, so a question never comes back), and the
  defaults the confirm names. Stall recovery runs only after a go tap. Streams over SSE. A made piece
  generates as a live preview in the thread (no jump to the review page);
  the agent changes it with edit_flyer / revise_piece, which the card runs
  through the review page's own endpoints. Campaigns hand off to
  the factory (research optional, editable plan, quote, "Test 3 first" or
  "Make all", approve-all).
- **UI (Oct 15):** the home landing is a Launchpad: 3D glass kind tiles,
  then "Waiting on you" and "Recent work" rows (hidden while a chat thread is
  open). Library is a visual hub with counts and a Latest grid; Review has
  kind filters and a sticky approve-all; campaigns are cards with send
  progress; empty states carry art. Mobile tab bar has a raised Create button
  and a Review count badge (sidebar too). The art (Higgsfield, Nano Banana
  Pro) lives in `assets/art/`.
- **Pipelines:** email (angle pick, draft, QA that revises once, optional
  design critique), blog (Portable Text, FAQ, internal links, live Sanity
  publish), flyers (4 options per click, design looks, FB/IG ad copy mode).
- **Review/editing:** click-to-edit regions, redesign, undo, CTA and image
  links, thumbs feedback and reviewer edits feeding the guidelines synthesis.
- **Publishing:** MailerLite send/schedule plus webhook-driven stats; Sanity;
  Facebook/Instagram posting code (not live, see below); a daily cron posts
  due social posts and runs recurring schedules.
- **Brand brain:** onboarding, settings, website import, brand guidelines
  doc, reference emails, email design references, competitor ad library
  (including Ad Library import via ScrapeCreators), design looks.
- **Billing:** credits ledger, paywall, Stripe Checkout for packs and Pro,
  monthly allowance cron.
- **Admin:** `/logs` and `/prompts`, gated by `user_profiles.role`.
- **Migrations:** all through 031 are applied (checked live 2026-10-14).
- **Checks:** `npm run typecheck`, `npm test` (873 tests), `npm run lint`
  (0 errors, 14 warnings), `npm run build`. `next build` runs lint, so a lint
  error now fails the deploy.

## Open: needs Jordan

1. **Local `ANTHROPIC_API_KEY` is invalid (401).** Every Claude call fails
   locally; production's key works. Replace it in `.env.local`.
2. **Logged-in click-through of the Oct 14 work** (none of it has been run end
   to end): the Create chat for each kind, a campaign with "Test 3 first"
   (spends roughly $0.15-0.40 plus the pieces), design looks and designed
   flyers, composed flyers on a brand whose font isn't on Google Fonts
   (falls back to Inter). Also the Create chat's web search (Oct 15):
   ask it to research something mid-interview. And the flyer style picker
   (Our style, No reference, Add examples) on Create and /flyers/new. And
   the flyer edit sheet's "Add an image" tab (Put it in the design / Copy
   its style). And the Create chat's live preview card: a flyer and an
   email generating in the thread, tapping options, asking for a change,
   attaching a photo for the flyer, and a reload keeping the card. None of
   the card UI has been seen rendered yet. And a flyer made from an attached reference
   for a client business (Oct 15): attach a design plus their logo in the
   Create chat, confirm no look picker appears, the 4 options follow the
   design in the client's colors with their logo, and "save as a look" works.
   And the Oct 15 UI upgrade, which passed typecheck, lint, tests and build
   but hasn't been seen rendered: the home Launchpad (tiles, rows, tile tap
   starting the chat), Review, Library, Campaigns, empty states, and the mobile
   tab bar, at phone and desktop widths in light and dark. And the Oct 16
   inputs work: label attached images In picture or Style, tick competitor ads
   (the look picker should show Their ads selected), then make a flyer, an
   email, a blog, and a campaign test launch, and check each used the right
   photos and style (drafts' `meta.inputs`, the saved image prompts).
3. **Meta app for Facebook/Instagram.** `META_APP_ID`, `META_APP_SECRET`,
   `META_LOGIN_CONFIG_ID` aren't in Vercel. Public posting also needs App
   Review and likely Business Verification. Add the META vars to
   `.env.example`.
4. **Stripe:** `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are in Vercel,
   but `STRIPE_PRO_PRICE_ID` isn't and `billing_config.packs` is empty, so
   nothing is purchasable. Decide pricing, then test the webhook with real
   events.
5. **MailerLite:** no real "Send now"/"Schedule" has been done. An earlier
   "sent" campaign never delivered because the account hit its active
   subscriber limit; check the account before testing.
6. **SEO follow-through:** confirm mdawebsite's SEO changes are deployed, then
   publish one real blog from here and confirm it's live with its FAQ;
   submit the sitemap in Search Console; redirect www to the apex.
7. **Optional:** `OPENAI_API_KEY` (local + Vercel) to turn on GPT Image.
8. **Setup for good flyers:** upload the transparent PNG logo in Settings
   (the one on file is a JPG with a black square); add the print products
   with photos in Settings, Products & services (Import from your website
   reads them once `print.moguldesignagency.com` resolves: it has no A or
   CNAME record in Vercel DNS, so the live Shop link is dead too; add the
   domain to the mdawebsite project); build a default look from
   the best past designs (Flyers, New, Our style, Add examples) once the
   strict look read is deployed. Duplicate packages deleted 2026-10-15.
   (Gemini 402 resolved: renders worked at 17:40 UTC 2026-10-15.)

## Open: code (not started)

- Blog AI section-level copy editing (Plan 5 Phase B). Check with Jordan
  before starting.
- Feed performance (open/click rates) back into topic and angle selection
  beyond the current "top performing emails" ranking.
- In-app retry for a MailerLite campaign stuck as a draft after a failed
  schedule call.
- Google Search Console metrics for blogs.
- UI to pick an email/blog type override per topic.
- Seeded topics still map to placeholder product slugs.
- Remove the old screens the factory/chat redesign hid, once the new flow is
  confirmed live.
- Large files worth splitting when next touched: `lib/db/queries.ts`,
  `create-agent.tsx`, `review-actions.tsx`, `lib/pipeline/generate.ts`,
  `app/api/create/chat/route.ts`.

## Gotchas

- `vercel env pull` can't pull values stored as Secrets; they come down as
  `[SENSITIVE]` placeholders.
- Supabase CLI needs the project ref: `supabase db query --linked
  --project-ref stujpgjxhyivsqvnhdfs "..."` (or `--file`).
- If a localhost:3000 app renders garbled or stale in dev, unregister leftover
  Service Workers (StackBot shares the port) before assuming the code is
  broken.
- Meta's own Ad Library API only returns political/issue ads, so ads come
  through ScrapeCreators.
- Stripe SDK 22: `current_period_end` lives on subscription items, and an
  invoice's subscription is at `parent.subscription_details.subscription`.

## How to verify this doc against reality

- `git log --oneline -20` and `git status` for what's committed and pushed.
- `ls db/migrations/`, then query the live DB with the Supabase CLI above to
  confirm a migration's table or column exists.
- `vercel env ls production` for which env vars are set in production.
