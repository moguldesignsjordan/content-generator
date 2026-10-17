import type {
  Brand,
  Icp,
  IcpProfile,
  MailerliteConfig,
  OnboardingInput,
  OnboardingMainAction,
  OnboardingProposal,
  OnboardingSource,
  Positioning,
  SeoDefaults,
  Strategy,
  VisualIdentity,
  VoiceProfile,
  VoiceSample,
} from "@/lib/db/types";
import type { WebsiteImport } from "@/lib/pipeline/import-website";
import { displayDomain } from "@/prompts/generate-flyer";

// Onboarding's pure logic: merge what the site and the web search found into
// one proposal, then turn the owner's confirmed copy into database writes.
// No I/O here, so every mapping is unit-tested.

/** What the web search found about the business (prompts/research-business.ts). */
export interface BusinessResearch {
  name?: string;
  website?: string;
  phone?: string;
  postal_address?: string;
  service_area?: string;
  rating?: string;
  /** Why customers pick them, from reviews. */
  praise: string[];
  pains: string[];
  customer_words: string[];
  objections: string[];
  competitors: string[];
  main_action?: OnboardingMainAction;
  guarantee?: string;
  sources: OnboardingSource[];
}

const MAX_CHIPS = 8;
const MAX_COMPETITORS = 6;
const MAX_AUDIENCE_ITEMS = 6;

/** Case-insensitive dedupe, first spelling wins, capped. */
function mergeLists(max: number, ...lists: (string[] | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of lists.flatMap((l) => l ?? [])) {
    const value = item.trim();
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out.slice(0, max);
}

/** "acme.com" → "https://acme.com": typed sites become real links, since
 * the email footer and CTAs link to them. */
export function withProtocol(url: string | undefined): string | undefined {
  const value = url?.trim();
  if (!value) return undefined;
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

/** "https://www.acme-roofing.com/" → "acme-roofing.com": the stand-in name
 * until the owner confirms the real one. */
export function provisionalName(input: OnboardingInput): string {
  if (input.name?.trim()) return input.name.trim();
  return input.url ? displayDomain(input.url).split("/")[0] : "My business";
}

/**
 * One proposal from the site import and the web research, either of which
 * may be missing. The site wins where both found something (it's the
 * owner's own words); research fills the gaps and adds review-backed chips.
 */
export function buildProposal(args: {
  site: WebsiteImport | null;
  research: BusinessResearch | null;
  input: OnboardingInput;
}): OnboardingProposal {
  const { input } = args;
  const site = args.site?.proposal;
  const extras = args.site?.extras;
  const research = args.research;
  const vi = site?.visual_identity;

  const audienceFromSite = extras?.audience ?? {};
  const audience = {
    label: audienceFromSite.label,
    demographics: audienceFromSite.demographics,
    pains: mergeLists(MAX_AUDIENCE_ITEMS, audienceFromSite.pains, research?.pains),
    objections: mergeLists(MAX_AUDIENCE_ITEMS, audienceFromSite.objections, research?.objections),
    vocabulary: mergeLists(MAX_AUDIENCE_ITEMS, audienceFromSite.vocabulary, research?.customer_words),
  };
  const hasAudience = Boolean(
    audience.label ||
      audience.demographics ||
      audience.pains.length ||
      audience.objections.length ||
      audience.vocabulary.length,
  );

  const mainAction = extras?.main_action?.kind
    ? extras.main_action
    : research?.main_action?.kind
      ? research.main_action
      : {};

  return {
    name: extras?.brand_name ?? research?.name ?? provisionalName(input),
    description: site?.positioning?.business_description ?? (input.description?.trim() || undefined),
    tagline: site?.positioning?.tagline,
    logo_url: vi?.logo_url,
    colors: vi?.colors,
    fonts: vi?.fonts,
    products: site?.products ?? [],
    audience,
    differentiators: mergeLists(MAX_CHIPS, site?.positioning?.differentiators, research?.praise),
    competitors: mergeLists(MAX_COMPETITORS, site?.positioning?.competitors, research?.competitors),
    main_action: mainAction,
    phone: extras?.phone ?? research?.phone,
    website: site?.source_url ?? research?.website ?? withProtocol(input.url),
    contact_email: vi?.footer?.contact_email,
    social: vi?.footer?.social,
    service_area: extras?.service_area ?? research?.service_area ?? (input.city?.trim() || undefined),
    postal_address: extras?.postal_address ?? research?.postal_address,
    guarantee: extras?.guarantee ?? research?.guarantee,
    example_lines: site?.voice_profile?.example_posts ?? [],
    site_voice:
      site?.voice_profile?.voice || site?.voice_profile?.tone
        ? { voice: site.voice_profile.voice, tone: site.voice_profile.tone }
        : undefined,
    rating: research?.rating,
    // The audience is inferred from how the site and reviews read, never
    // stated by the owner, so it's always shown as a guess to confirm.
    guesses: hasAudience ? ["audience"] : [],
    sources: research?.sources ?? [],
  };
}

const ACTION_DEFAULTS: Record<NonNullable<OnboardingMainAction["kind"]>, string> = {
  call: "Call",
  book: "Book",
  visit: "Visit",
  order: "Order",
  quote: "Get a quote",
  message: "Message us",
};

/**
 * The main action as one line a writer can use as the call to action, e.g.
 * "Call (214) 555-0101 for a free roof inspection". Undefined without a kind.
 */
export function mainActionLine(
  action: OnboardingMainAction,
  phone?: string,
  website?: string,
): string | undefined {
  if (!action.kind) return undefined;
  const wording = action.wording?.trim();
  const link = action.url || website;
  const domain = link ? displayDomain(link) : undefined;
  const forWhat = wording ? ` for ${wording}` : "";
  switch (action.kind) {
    case "call":
      return phone ? `Call ${phone}${forWhat}` : `Call us${forWhat}`;
    case "book":
      return `Book ${wording || "an appointment"}${domain ? ` at ${domain}` : ""}`;
    case "visit":
      return `Visit ${domain ?? "us"}${forWhat}`;
    case "order":
      return `Order ${wording || "online"}${domain ? ` at ${domain}` : ""}`;
    case "quote":
      return `${ACTION_DEFAULTS.quote}${forWhat}${
        phone ? `: call ${phone}` : domain ? ` at ${domain}` : ""
      }`;
    case "message":
      return `${ACTION_DEFAULTS.message}${wording ? ` about ${wording}` : ""}${
        phone ? ` at ${phone}` : domain ? ` at ${domain}` : ""
      }`;
  }
}

/** A product row ready for upsertProduct; the route mirrors the photo first. */
export interface ProductWrite {
  slug: string;
  name: string;
  description: string | null;
  deliverables: string[];
  price_point: string | null;
  url: string | null;
  image_url?: string;
}

export interface SnapshotWrites {
  basics: { name: string; mailerlite_config: MailerliteConfig; seo_defaults: SeoDefaults };
  positioning: Positioning;
  visualIdentity: VisualIdentity;
  products: ProductWrite[];
  icp: { id: string; label: string; profile: IcpProfile } | null;
  /** Only when there's a main action to put in the CTA library. */
  voiceProfile: VoiceProfile | null;
  funnel: Strategy["funnel_definition"] | null;
}

const orUndefined = <T,>(list: T[] | undefined) => (list?.length ? list : undefined);

/**
 * Every write the confirmed snapshot makes, merged over what's stored so a
 * field onboarding doesn't touch is kept. Unticked items were already left
 * out of the snapshot by the client. Never writes banned terms, the sender,
 * the auto-images switch, or guidelines.
 */
export function snapshotToWrites(
  snapshot: OnboardingProposal,
  ctx: { brand: Brand; strategy: Strategy; primaryIcp: Icp },
): SnapshotWrites {
  const { brand, strategy, primaryIcp } = ctx;
  const name = snapshot.name.trim() || brand.name;
  const line = mainActionLine(snapshot.main_action, snapshot.phone?.trim(), withProtocol(snapshot.website));

  const pos = brand.positioning ?? {};
  const positioning: Positioning = {
    ...pos,
    business_description: snapshot.description?.trim() || pos.business_description,
    tagline: snapshot.tagline?.trim() || pos.tagline,
    differentiators: orUndefined(snapshot.differentiators) ?? pos.differentiators,
    competitors: orUndefined(snapshot.competitors) ?? pos.competitors,
    service_area: snapshot.service_area?.trim() || pos.service_area,
    main_action: line ?? pos.main_action,
  };

  const vi = brand.visual_identity ?? {};
  const footer = vi.footer ?? {};
  const visualIdentity: VisualIdentity = {
    ...vi,
    logo_url: snapshot.logo_url || vi.logo_url,
    logo_alt: name,
    colors: snapshot.colors ? { ...vi.colors, ...snapshot.colors } : vi.colors,
    fonts: snapshot.fonts ? { ...vi.fonts, ...snapshot.fonts } : vi.fonts,
    footer: {
      ...footer,
      website: withProtocol(snapshot.website) ?? footer.website,
      phone: snapshot.phone?.trim() || footer.phone,
      contact_email: snapshot.contact_email?.trim() || footer.contact_email,
      postal_address: snapshot.postal_address?.trim() || footer.postal_address,
      guarantee: snapshot.guarantee?.trim() || footer.guarantee,
      social: snapshot.social ? { ...footer.social, ...snapshot.social } : footer.social,
    },
  };

  const products: ProductWrite[] = snapshot.products
    .filter((p) => p.slug.trim() && p.name.trim())
    .map((p) => ({
      slug: p.slug.trim(),
      name: p.name.trim(),
      description: p.description?.trim() || null,
      deliverables: p.deliverables ?? [],
      price_point: p.price_point?.trim() || null,
      url: p.url?.trim() || null,
      image_url: p.image_url,
    }));

  const a = snapshot.audience;
  const hasAudience = Boolean(
    a.label?.trim() || a.demographics?.trim() || a.pains?.length || a.objections?.length || a.vocabulary?.length,
  );
  const cur = primaryIcp.profile ?? {};
  const icp = hasAudience
    ? {
        id: primaryIcp.id,
        label: a.label?.trim() || primaryIcp.label,
        profile: {
          ...cur,
          demographics: a.demographics?.trim() || cur.demographics,
          pains: orUndefined(a.pains) ?? cur.pains,
          objections: orUndefined(a.objections) ?? cur.objections,
          vocabulary: orUndefined(a.vocabulary) ?? cur.vocabulary,
        },
      }
    : null;

  // The main action becomes the decision CTA, and consideration points at
  // it too: a small business has one real next step, not a newsletter.
  const voiceProfile: VoiceProfile | null = line
    ? {
        ...brand.voice_profile,
        cta_library: { ...brand.voice_profile?.cta_library, book_call: line },
      }
    : null;
  const funnel = line
    ? {
        ...strategy.funnel_definition,
        consideration: { cta_type: "book_call" },
        decision: { cta_type: "book_call" },
      }
    : null;

  return {
    basics: {
      name,
      mailerlite_config: brand.mailerlite_config ?? {},
      seo_defaults: brand.seo_defaults ?? {},
    },
    positioning,
    visualIdentity,
    products,
    icp,
    voiceProfile,
    funnel,
  };
}

/** Fewer real lines than this and the picked sample joins them as an example. */
const MIN_REAL_EXAMPLES = 2;

/**
 * The voice the owner picked, merged over the stored voice profile: the
 * sample's voice and tone, the site's verbatim lines as examples, and the
 * sample itself only when the site gave too few lines to imitate.
 */
export function voiceToWrites(
  pick: Pick<VoiceSample, "voice" | "tone" | "text">,
  exampleLines: string[],
  current: VoiceProfile,
): VoiceProfile {
  const real = exampleLines.map((l) => l.trim()).filter(Boolean);
  const examples = real.length < MIN_REAL_EXAMPLES ? [...real, pick.text.trim()] : real;
  return {
    ...current,
    voice: pick.voice.trim(),
    tone: pick.tone.trim(),
    example_posts: examples,
  };
}
