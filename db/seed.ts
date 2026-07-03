/**
 * Seeds ONE brand's strategy (Mogul Design Agency) following the schema in
 * brand-strategy-template.md: ICP → pillars → hub-and-spoke clusters → topics.
 *
 * Run with:  npm run seed
 *
 * Idempotent: deletes any existing "Mogul Design Agency" brand first (cascade
 * removes its strategy/icps/pillars/clusters/topics), then re-inserts fresh.
 *
 * This is a DRAFT strategy meant to be edited against real evidence (customer
 * calls, competitor reviews, GSC data), see brand-strategy-template.md §5.
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  console.error(
    "✗ Missing Supabase env. Fill NEXT_PUBLIC_SUPABASE_URL and " +
      "SUPABASE_SERVICE_ROLE_KEY in .env.local, then re-run `npm run seed`.",
  );
  process.exit(1);
}

const db = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ── Brand profile (voice / identity / SEO defaults) ─────────────────────────

const BRAND = {
  name: "Mogul Design Agency",
  voice_profile: {
    voice:
      "Confident, plain-spoken, and sharp. Talks to founders as a peer who has " +
      "shipped real brands, opinionated and practical, never salesy or fluffy.",
    tone: "Direct, encouraging, a little bold. Short sentences. No agency jargon.",
    example_posts: [
      "Your logo isn't your brand. Your brand is the gut-feeling someone gets " +
        "before they've read a single word. The logo is just the part you can see.",
      "Most founders rebrand too late, usually right after losing a deal to a " +
        "competitor who simply looked more credible. Don't wait for the wake-up call.",
      "A $50 Fiverr logo costs you nothing up front and a fortune in lost trust. " +
        "Cheap branding is the most expensive kind.",
    ],
    banned_terms: [
      "synergy",
      "best-in-class",
      "world-class",
      "cutting-edge",
      "game-changer",
      "revolutionary",
      "ninja",
      "rockstar",
      "guru",
      "leverage", // as a buzzword verb
    ],
    // Keyed by funnel CTA type (see funnel_definition below).
    cta_library: {
      newsletter_signup:
        "Get one sharp branding insight in your inbox each week, subscribe to the Mogul newsletter.",
      portfolio: "See how we've done this for brands like yours, explore our work.",
      book_call:
        "Book a free brand audit call and we'll show you exactly where your brand is leaking trust.",
    },
  },
  sanity_config: {
    project_id: "",
    dataset: "production",
    doc_type: "post",
    author_ref: "",
  },
  mailerlite_config: {
    sender_name: "Mogul Design Agency",
    sender_email: "jordan@moguldesignagency.com",
    group_ids: [] as string[],
  },
  seo_defaults: {
    geography: "US",
    language: "en",
    keyword_difficulty_max: 40,
  },
  visual_identity: {
    logo_url: "",
    logo_alt: "Mogul Design Agency",
    // Mogul brand tokens. The email templates read these via resolveBrandTokens,
    // so generated emails get the real spectrum accent + Ink type, not the
    // stale slate/blue defaults. (Logo bucket upload is still pending; emails
    // fall back to the typographic wordmark until logo_url is set.)
    colors: {
      primary: "#08080A", // Ink, headings + wordmark
      secondary: "#3A3A40", // Slate, lead paragraph
      accent: "#FF3D8C", // Hot Magenta, CTA + accents
      background: "#FFFFFF", // email card
      text: "#08080A", // Ink, body
      muted: "#6B6B72", // footer / meta (>=4.5:1 on white)
    },
    fonts: {
      // Web fonts don't render reliably across email clients, so use a clean
      // system sans stack. The app UI uses Clash/Hanken; emails stay safe.
      heading: "Helvetica Neue, Arial, sans-serif",
      body: "Helvetica Neue, Arial, sans-serif",
    },
    footer: {
      contact_email: "jordan@moguldesignagency.com",
      website: "https://moguldesignagency.com",
      social: {
        linkedin: "",
        twitter: "",
        instagram: "",
        youtube: "",
      },
    },
  },
  positioning: {
    business_description:
      "Mogul Design Agency builds brand identity systems for scaling startups " +
      "and SMBs, positioning, visual identity, and the guidelines that make a " +
      "brand look as credible as it actually is.",
    tagline: "Brands that look as credible as they are.",
    differentiators: [
      "Strategy-first: positioning and messaging before any pixel moves",
      "Founder-to-founder voice, opinionated and practical, not agency fluff",
      "Ship-ready brand systems with real guidelines, not just a logo",
    ],
    competitors: ["Pentagram", "MetaLab", "independent brand freelancers"],
  },
  onboarding_state: {
    messages: [],
    completed: true, // Mogul's profile is already complete, don't nag it.
  },
};

// ── Products (the offers topics map to via maps_to_product) ─────────────────
// DRAFT copy for Jordan to correct in Settings → Products & services. The
// generation prompt reads these so emails pitch a real offer, not a slug.

const PRODUCTS = [
  {
    slug: "brand-strategy-service",
    name: "Brand Strategy Sprint",
    description:
      "A focused engagement that nails positioning, messaging, and audience " +
      "before any design work: what the brand stands for, who it serves, and " +
      "why it wins. (Draft copy: edit with real scope and pricing.)",
    deliverables: [
      "Positioning statement and messaging framework",
      "Audience and competitor analysis",
      "Brand voice and tone guide",
    ],
    price_point: "Starting around $X,XXX (draft: set real pricing)",
    url: "https://moguldesignagency.com",
  },
  {
    slug: "brand-identity-service",
    name: "Brand Identity System",
    description:
      "A complete, ship-ready visual identity: logo, color, typography, and " +
      "the guidelines that keep it consistent everywhere it shows up. " +
      "(Draft copy: edit with real scope and pricing.)",
    deliverables: [
      "Logo suite and usage rules",
      "Color and typography system",
      "Brand guidelines document",
    ],
    price_point: "Starting around $X,XXX (draft: set real pricing)",
    url: "https://moguldesignagency.com",
  },
  {
    slug: "rebrand-service",
    name: "Full Rebrand",
    description:
      "Strategy plus identity for brands that have outgrown their look: " +
      "repositioning, a new visual system, and a rollout plan that doesn't " +
      "break momentum. (Draft copy: edit with real scope and pricing.)",
    deliverables: [
      "Repositioning and messaging",
      "New visual identity system",
      "Rollout and migration plan",
    ],
    price_point: "Starting around $XX,XXX (draft: set real pricing)",
    url: "https://moguldesignagency.com",
  },
];

const FUNNEL_DEFINITION = {
  awareness: { cta_type: "newsletter_signup" },
  consideration: { cta_type: "portfolio" },
  decision: { cta_type: "book_call" },
};

// ── ICPs ────────────────────────────────────────────────────────────────────

const ICPS = [
  {
    label: "The Scaling Founder With a DIY Brand",
    is_primary: true,
    profile: {
      demographics:
        "Founders/owners of startups & SMBs, ~$500K to $10M revenue, 5 to 50 staff. " +
        "Often post-seed/Series A or bootstrapped and growing fast.",
      values: ["credibility", "growth", "standing out", "looking legit", "speed"],
      jobs_to_be_done: [
        "look as credible as we actually are",
        "stand out from look-alike competitors",
        "stop being embarrassed to share our website",
        "win bigger clients and investors",
      ],
      pains: [
        "brand looks DIY / amateur",
        "inconsistent across website, deck, and social",
        "no brand guidelines",
        "logo made in Canva or on Fiverr",
        "website doesn't convert",
        "blends in with everyone else in the category",
      ],
      triggers: [
        "raising a funding round",
        "launching a new product",
        "entering a new market",
        "pitching investors",
        "hiring and scaling the team",
        "embarrassed showing the website to a prospect",
      ],
      objections: [
        "agencies are too expensive",
        "a freelancer is cheaper",
        "we can DIY it in Canva",
        "it takes too long",
        "not sure the ROI is there",
      ],
      awareness_stage: "problem/solution-aware, low product-awareness",
      vocabulary: [
        "brand identity",
        "logo design",
        "brand guidelines",
        "rebrand",
        "visual identity",
        "brand strategy",
        "look professional",
        "stand out",
      ],
    },
  },
  {
    label: "The Marketing Lead at a Funded Startup",
    is_primary: false,
    profile: {
      demographics:
        "Head/VP of Marketing at a Series A to B startup. Has budget and a board " +
        "to answer to; design-literate; needs an execution partner, not hand-holding.",
      values: ["execution speed", "consistency", "measurable impact"],
      jobs_to_be_done: [
        "ship a coherent brand system across channels",
        "free the team from one-off design requests",
      ],
      pains: ["brand drift across teams", "no scalable design system"],
      triggers: ["new funding", "category repositioning", "headcount growth"],
      objections: ["already have an in-house designer", "switching cost"],
      awareness_stage: "solution- and product-aware",
      vocabulary: ["design system", "brand refresh", "rebrand", "design ops"],
    },
  },
];

// ── Pillars (mostly awareness/consideration, exactly one decision) ──────────

const PILLARS = [
  {
    name: "Brand Strategy & Positioning",
    description:
      "The thinking before the design: positioning, messaging, and what a " +
      "brand actually is. The awareness workhorse that captures founders early.",
    business_goal: "SEO authority + trust; top-of-funnel demand",
    primary_funnel_stage: "awareness" as const,
    target_icp: "The Scaling Founder With a DIY Brand",
  },
  {
    name: "Visual Identity & Design",
    description:
      "Logos, color, typography, and brand systems done right, practical " +
      "standards founders can judge their own brand against.",
    business_goal: "Authority + brand affinity; maps to design services",
    primary_funnel_stage: "awareness" as const,
    target_icp: "The Scaling Founder With a DIY Brand",
  },
  {
    name: "Hiring & Working With a Design Agency",
    description:
      "Commercial-intent content for founders comparing options: agency vs " +
      "freelancer, what it costs, how the process works. High conversion.",
    business_goal: "Capture buyers in active evaluation",
    primary_funnel_stage: "consideration" as const,
    target_icp: "The Scaling Founder With a DIY Brand",
  },
  {
    name: "The Mogul Way",
    description:
      "Case studies, our process, and results. Decision-stage content for " +
      "people who already know us, low volume, high intent.",
    business_goal: "Decision-stage conversion",
    primary_funnel_stage: "decision" as const,
    target_icp: "The Scaling Founder With a DIY Brand",
  },
];

// ── Clusters (hub) + topics (spokes). Pillars 1 & 3 fully expanded; 2 & 4
//    seeded with a hub + a couple of ideas to work through. ────────────────────

interface SeedTopic {
  title: string;
  target_keyword: string;
  intent: string;
  funnel_stage: "awareness" | "consideration" | "decision" | "brand";
  internal_link_targets: string[];
  maps_to_product: string | null;
  distribution_recipe: string[];
  status?: "idea" | "queued" | "in_progress" | "published";
}

interface SeedCluster {
  pillar: string;
  hub_title: string;
  hub_keyword: string;
  hub_intent: string;
  topics: SeedTopic[];
}

const CLUSTERS: SeedCluster[] = [
  {
    pillar: "Brand Strategy & Positioning",
    hub_title: "The Founder's Guide to Brand Strategy",
    hub_keyword: "brand strategy",
    hub_intent: "informational",
    topics: [
      {
        title: "Brand Strategy vs Brand Identity: What's the Difference?",
        target_keyword: "brand strategy vs brand identity",
        intent: "informational",
        funnel_stage: "awareness",
        internal_link_targets: ["hub", "visual-identity-hub"],
        maps_to_product: "brand-strategy-service",
        distribution_recipe: ["newsletter_tip", "linkedin_post"],
        status: "queued",
      },
      {
        title: "What Are Brand Pillars (And How to Define Yours)",
        target_keyword: "brand pillars",
        intent: "informational",
        funnel_stage: "awareness",
        internal_link_targets: ["hub"],
        maps_to_product: "brand-strategy-service",
        distribution_recipe: ["newsletter_tip", "linkedin_carousel"],
        status: "queued",
      },
      {
        title: "How to Write a Brand Positioning Statement (With Examples)",
        target_keyword: "brand positioning statement",
        intent: "informational",
        funnel_stage: "awareness",
        internal_link_targets: ["hub"],
        maps_to_product: "brand-strategy-service",
        distribution_recipe: ["newsletter_howto", "linkedin_post"],
      },
      {
        title: "7 Signs Your Startup Has Outgrown Its Brand",
        target_keyword: "when to rebrand",
        intent: "commercial investigation",
        funnel_stage: "consideration",
        internal_link_targets: ["hub", "hiring-hub"],
        maps_to_product: "rebrand-service",
        distribution_recipe: ["newsletter_feature", "linkedin_post"],
      },
      {
        title: "How Much Does Brand Strategy Cost? (Honest Breakdown)",
        target_keyword: "brand strategy cost",
        intent: "commercial",
        funnel_stage: "consideration",
        internal_link_targets: ["hub", "hiring-hub"],
        maps_to_product: "brand-strategy-service",
        distribution_recipe: ["newsletter_feature", "linkedin_post"],
      },
      {
        title: "A Step-by-Step Brand Strategy Framework (Free Template)",
        target_keyword: "brand strategy framework",
        intent: "informational",
        funnel_stage: "awareness",
        internal_link_targets: ["hub"],
        maps_to_product: "brand-strategy-service",
        distribution_recipe: ["newsletter_howto", "lead_magnet"],
      },
    ],
  },
  {
    pillar: "Hiring & Working With a Design Agency",
    hub_title: "How to Hire a Branding Agency (Founder's Playbook)",
    hub_keyword: "how to hire a branding agency",
    hub_intent: "commercial",
    topics: [
      {
        title: "Branding Agency vs Freelancer: Which Is Right for You?",
        target_keyword: "branding agency vs freelancer",
        intent: "commercial investigation",
        funnel_stage: "consideration",
        internal_link_targets: ["hub", "mogul-way-hub"],
        maps_to_product: "brand-identity-service",
        distribution_recipe: ["newsletter_feature", "linkedin_post"],
        status: "queued",
      },
      {
        title: "How Much Does a Branding Agency Cost in 2026?",
        target_keyword: "branding agency cost",
        intent: "commercial",
        funnel_stage: "consideration",
        internal_link_targets: ["hub"],
        maps_to_product: "brand-identity-service",
        distribution_recipe: ["newsletter_feature", "linkedin_post"],
      },
      {
        title: "12 Questions to Ask Before Hiring a Design Agency",
        target_keyword: "questions to ask a design agency",
        intent: "commercial investigation",
        funnel_stage: "consideration",
        internal_link_targets: ["hub", "mogul-way-hub"],
        maps_to_product: "brand-identity-service",
        distribution_recipe: ["newsletter_howto", "linkedin_carousel"],
      },
    ],
  },
  {
    pillar: "Visual Identity & Design",
    hub_title: "The Founder's Guide to a Professional Visual Identity",
    hub_keyword: "visual identity",
    hub_intent: "informational",
    topics: [
      {
        title: "What Makes a Logo Look Professional (and Cheap)",
        target_keyword: "professional logo design",
        intent: "informational",
        funnel_stage: "awareness",
        internal_link_targets: ["hub"],
        maps_to_product: "brand-identity-service",
        distribution_recipe: ["newsletter_tip", "linkedin_carousel"],
      },
      {
        title: "How to Choose Brand Colors That Actually Convert",
        target_keyword: "how to choose brand colors",
        intent: "informational",
        funnel_stage: "awareness",
        internal_link_targets: ["hub"],
        maps_to_product: "brand-identity-service",
        distribution_recipe: ["newsletter_howto", "linkedin_post"],
      },
    ],
  },
  {
    pillar: "The Mogul Way",
    hub_title: "How We Build Brands at Mogul (Our Process)",
    hub_keyword: "mogul design agency process",
    hub_intent: "navigational",
    topics: [
      {
        title: "Case Study: Rebranding a Seed-Stage SaaS in 6 Weeks",
        target_keyword: "saas rebrand case study",
        intent: "commercial",
        funnel_stage: "decision",
        internal_link_targets: ["hub", "book-call"],
        maps_to_product: "rebrand-service",
        distribution_recipe: ["newsletter_feature", "linkedin_post"],
      },
    ],
  },
];

// ── Insertion ────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Seeding "${BRAND.name}"…`);

  // Idempotency: remove any prior copy of this brand (cascade clears children).
  const { error: delErr } = await db
    .from("brands")
    .delete()
    .eq("name", BRAND.name);
  if (delErr) throw delErr;

  // brand
  const { data: brand, error: brandErr } = await db
    .from("brands")
    .insert({
      name: BRAND.name,
      voice_profile: BRAND.voice_profile,
      visual_identity: BRAND.visual_identity,
      positioning: BRAND.positioning,
      onboarding_state: BRAND.onboarding_state,
      sanity_config: BRAND.sanity_config,
      mailerlite_config: BRAND.mailerlite_config,
      seo_defaults: BRAND.seo_defaults,
    })
    .select("id")
    .single();
  if (brandErr) throw brandErr;

  // products (brand delete above cascaded any prior rows, so plain insert).
  // Warn-and-skip when the table doesn't exist yet (migration 002 not applied)
  // so the rest of the seed still lands.
  const { error: productErr } = await db.from("products").insert(
    PRODUCTS.map((p) => ({ brand_id: brand.id, ...p })),
  );
  if (productErr) {
    const missingTable =
      productErr.code === "PGRST205" ||
      productErr.code === "42P01" ||
      productErr.message?.includes("schema cache");
    if (!missingTable) throw productErr;
    console.warn(
      "⚠ products table missing, apply db/migrations/002_campaigns_products_guidelines.sql " +
        "in the Supabase SQL editor, then re-run `npm run seed`.",
    );
  }

  // strategy
  const { data: strategy, error: stratErr } = await db
    .from("strategies")
    .insert({ brand_id: brand.id, funnel_definition: FUNNEL_DEFINITION })
    .select("id")
    .single();
  if (stratErr) throw stratErr;

  // icps → keep label→id map for pillar linkage
  const icpIdByLabel = new Map<string, string>();
  for (const icp of ICPS) {
    const { data, error } = await db
      .from("icps")
      .insert({
        strategy_id: strategy.id,
        label: icp.label,
        is_primary: icp.is_primary,
        profile: icp.profile,
      })
      .select("id")
      .single();
    if (error) throw error;
    icpIdByLabel.set(icp.label, data.id);
  }

  // pillars → keep name→id map for cluster linkage
  const pillarIdByName = new Map<string, string>();
  for (const pillar of PILLARS) {
    const { data, error } = await db
      .from("pillars")
      .insert({
        strategy_id: strategy.id,
        name: pillar.name,
        description: pillar.description,
        business_goal: pillar.business_goal,
        primary_funnel_stage: pillar.primary_funnel_stage,
        target_icp_id: icpIdByLabel.get(pillar.target_icp) ?? null,
      })
      .select("id")
      .single();
    if (error) throw error;
    pillarIdByName.set(pillar.name, data.id);
  }

  // clusters + topics
  let topicCount = 0;
  for (const cluster of CLUSTERS) {
    const pillarId = pillarIdByName.get(cluster.pillar);
    if (!pillarId) throw new Error(`Unknown pillar: ${cluster.pillar}`);

    const { data: clusterRow, error: clusterErr } = await db
      .from("clusters")
      .insert({
        pillar_id: pillarId,
        hub_title: cluster.hub_title,
        hub_keyword: cluster.hub_keyword,
        hub_intent: cluster.hub_intent,
      })
      .select("id")
      .single();
    if (clusterErr) throw clusterErr;

    const rows = cluster.topics.map((t) => ({
      cluster_id: clusterRow.id,
      title: t.title,
      target_keyword: t.target_keyword,
      intent: t.intent,
      funnel_stage: t.funnel_stage,
      internal_link_targets: t.internal_link_targets,
      maps_to_product: t.maps_to_product,
      distribution_recipe: t.distribution_recipe,
      status: t.status ?? "idea",
    }));
    const { error: topicErr } = await db.from("topics").insert(rows);
    if (topicErr) throw topicErr;
    topicCount += rows.length;
  }

  console.log(
    `✓ Seeded ${BRAND.name}: ${PRODUCTS.length} products, ${ICPS.length} ICPs, ` +
      `${PILLARS.length} pillars, ${CLUSTERS.length} clusters, ${topicCount} topics.`,
  );
}

main().catch((err) => {
  console.error("✗ Seed failed:", err);
  process.exit(1);
});
