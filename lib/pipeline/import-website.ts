import "server-only";
import { z } from "zod";
import { DRAFT_MODEL, getAnthropic, logUsage } from "@/lib/clients/anthropic";
import {
  MAIN_ACTION_KINDS,
  type BrandImportProposal,
  type OnboardingAudience,
  type OnboardingMainAction,
  type ProposedProduct,
} from "@/lib/db/types";
import { scrapeSite } from "@/lib/scrape";
import { mirrorLogoToStorage } from "@/lib/scrape/logo";
import { pickPhone } from "@/lib/scrape/phones";
import { generateBrandIdentity } from "@/lib/pipeline/brand-identity";
import {
  IMPORT_TOOL,
  buildImportMessages,
  cleanImportedProducts,
  type ImportToolInput,
} from "@/prompts/import-website";
import { addShareImages, mergeProducts, scrapeProducts } from "@/lib/scrape/products";
import { stripEmDashes } from "@/lib/text";
import { logWarn } from "@/lib/log";

/** The model answered without the extraction tool. */
export class ImportEmptyError extends Error {}

/** What onboarding reads from the site beyond the Settings proposal. */
export interface SiteExtras {
  brand_name?: string;
  phone?: string;
  service_area?: string;
  main_action: OnboardingMainAction;
  audience: OnboardingAudience;
  guarantee?: string;
  postal_address?: string;
}

export interface WebsiteImport {
  proposal: BrandImportProposal;
  extras: SiteExtras;
}

const clean = (s?: string) => {
  const out = s ? stripEmDashes(s.trim()) : undefined;
  return out || undefined;
};
const cleanList = (l?: string[]) => {
  const out = l?.map((s) => stripEmDashes(s.trim())).filter(Boolean);
  return out?.length ? out : undefined;
};

const bareHost = (url: string) => new URL(url).hostname.replace(/^www\./, "");

/** A link the extraction picked, kept only when it's on the scraped site. */
function sameHostUrl(raw: string | undefined, origin: string): string | undefined {
  const value = raw?.trim();
  if (!value) return undefined;
  try {
    const abs = new URL(value, origin).toString();
    return bareHost(abs) === bareHost(origin) ? abs : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Scrapes a site and extracts a brand PROPOSAL with Claude: zero database
 * writes. Settings' import review and onboarding both start here. Throws
 * ScrapeError when the site can't be read, ImportEmptyError when the model
 * returns nothing.
 */
export async function importWebsite(
  url: string,
  opts: {
    brandId: string;
    /** For the logo's alt text and the palette fallback. */
    brandName: string;
    /** Called once the pages are read, before the extraction call. */
    onScraped?: (pageCount: number) => void;
  },
): Promise<WebsiteImport> {
  // Runs alongside the page scan and the extraction; never fails the import.
  const structuredProducts = scrapeProducts(url)
    .then((r) => r.products)
    .catch(() => [] as ProposedProduct[]);
  const scrape = await scrapeSite(url);
  opts.onScraped?.(scrape.pages.length);
  const { system, user } = buildImportMessages(scrape);

  const response = await getAnthropic().messages.create({
    model: DRAFT_MODEL,
    max_tokens: 8192,
    system,
    messages: [{ role: "user", content: user }],
    tools: [IMPORT_TOOL],
    tool_choice: { type: "tool", name: "save_brand_extraction" },
  });
  logUsage("import-website", DRAFT_MODEL, response.usage, {
    brandId: opts.brandId,
  });

  const tu = response.content.find(
    (b) => b.type === "tool_use" && b.name === "save_brand_extraction",
  );
  if (!tu || tu.type !== "tool_use") {
    throw new ImportEmptyError("The model returned nothing. Try again.");
  }
  const raw = tu.input as ImportToolInput;

  // Colors and logo must come from the extracted candidates: anything else
  // is a hallucination and gets dropped here (the prompt's promise, enforced).
  const knownColors = new Set(scrape.signals.color_candidates.map((c) => c.hex));
  const color = (v?: string) => {
    const hex = v?.trim().toLowerCase();
    return hex && /^#[0-9a-f]{6}$/.test(hex) && knownColors.has(hex)
      ? hex
      : undefined;
  };
  const knownFonts = new Set(scrape.signals.font_candidates);
  const font = (v?: string) => {
    const f = v?.trim();
    return f && knownFonts.has(f) ? f : clean(v); // accept cleaned free text only if non-empty
  };
  const logoCandidates = [
    ...scrape.signals.logo_candidates,
    ...scrape.signals.icon_candidates,
  ];
  const chosenLogo =
    raw.logo_url && logoCandidates.includes(raw.logo_url.trim())
      ? raw.logo_url.trim()
      : undefined;

  const mirrored = await mirrorLogoToStorage(
    chosenLogo
      ? [chosenLogo, ...logoCandidates.filter((c) => c !== chosenLogo)]
      : logoCandidates,
  );

  // The extraction's words, with photos and prices from the site's
  // structured data; an offer still without a photo takes its page's.
  const products: ProposedProduct[] = await addShareImages(
    mergeProducts(cleanImportedProducts(raw.products), await structuredProducts),
    scrape.origin,
  );

  const email = clean(raw.contact_email);
  let colors = {
    primary: color(raw.color_primary),
    secondary: color(raw.color_secondary),
    accent: color(raw.color_accent),
    background: color(raw.color_background),
    text: color(raw.color_text),
    muted: color(raw.color_muted),
  };
  let hasColors = Object.values(colors).some(Boolean);
  let fonts = { heading: font(raw.font_heading), body: font(raw.font_body) };
  let hasFonts = Object.values(fonts).some(Boolean);
  const social = {
    linkedin: clean(raw.social_linkedin),
    twitter: clean(raw.social_twitter),
    instagram: clean(raw.social_instagram),
    youtube: clean(raw.social_youtube),
  };
  const hasSocial = Object.values(social).some(Boolean);

  const voice = clean(raw.voice);
  const tone = clean(raw.tone);
  const exampleLines = cleanList(raw.example_lines);
  const bannedTerms = cleanList(raw.banned_terms);

  const businessDescription = clean(raw.business_description);
  const tagline = clean(raw.tagline);
  const differentiators = cleanList(raw.differentiators);
  const competitors = cleanList(raw.competitors);

  // The site's own CSS didn't yield usable colors (a real failure mode,
  // e.g. oklch()-only sites), but we still have real context from this
  // same scrape: whatever color/font candidates WERE found, the site's
  // meta description, and the voice/positioning just extracted above.
  // Ground a generated palette in that instead of leaving visual_identity
  // empty and falling back to generic defaults in every email.
  if (!hasColors) {
    try {
      const generated = await generateBrandIdentity({
        brandName: opts.brandName,
        positioning: { business_description: businessDescription, tagline },
        voiceProfile: { voice, tone },
        colorCandidates: scrape.signals.color_candidates,
        fontCandidates: scrape.signals.font_candidates,
        siteName: scrape.signals.site_name,
        metaDescription: scrape.signals.meta_description,
      });
      if (generated) {
        colors = generated.colors as typeof colors;
        hasColors = true;
        if (!hasFonts) {
          fonts = generated.fonts as typeof fonts;
          hasFonts = true;
        }
      }
    } catch (err) {
      logWarn(
        "pipeline:import-website:identity-fallback",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  const proposal: BrandImportProposal = {
    ...(voice || tone || exampleLines || bannedTerms
      ? {
          voice_profile: {
            voice,
            tone,
            example_posts: exampleLines,
            banned_terms: bannedTerms,
          },
        }
      : {}),
    ...(businessDescription || tagline || differentiators || competitors
      ? {
          positioning: {
            business_description: businessDescription,
            tagline,
            differentiators,
            competitors,
          },
        }
      : {}),
    ...(products.length ? { products } : {}),
    ...(mirrored || hasColors || hasFonts || email || hasSocial
      ? {
          visual_identity: {
            logo_url: mirrored?.url,
            logo_alt: clean(raw.logo_alt) ?? opts.brandName,
            ...(hasColors ? { colors } : {}),
            ...(hasFonts ? { fonts } : {}),
            footer: {
              website: scrape.origin,
              contact_email: email && z.email().safeParse(email).success ? email : undefined,
              ...(hasSocial ? { social } : {}),
            },
          },
        }
      : {}),
    audience_summary: clean(raw.audience_summary),
    source_url: scrape.origin,
    pages_scraped: scrape.pages.map((p) => p.url),
  };

  const kind = MAIN_ACTION_KINDS.find((k) => k === raw.main_action_kind);
  const extras: SiteExtras = {
    brand_name: clean(raw.brand_name),
    phone: pickPhone(raw.phone, scrape.signals.phones),
    service_area: clean(raw.service_area),
    main_action: {
      kind,
      wording: kind ? clean(raw.main_action_wording) : undefined,
      url: kind ? sameHostUrl(raw.main_action_url, scrape.origin) : undefined,
    },
    audience: {
      label: clean(raw.icp_label),
      demographics: clean(raw.icp_demographics),
      pains: cleanList(raw.icp_pains),
      objections: cleanList(raw.icp_objections),
      vocabulary: cleanList(raw.icp_vocabulary),
    },
    guarantee: clean(raw.guarantee),
    postal_address: clean(raw.postal_address),
  };

  return { proposal, extras };
}
