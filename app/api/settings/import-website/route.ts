import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  DRAFT_MODEL,
  getAnthropic,
  isAnthropicConfigured,
  logUsage,
} from "@/lib/clients/anthropic";
import { getBrandWithIcps } from "@/lib/db/queries";
import type { BrandImportProposal, ProposedProduct } from "@/lib/db/types";
import { ScrapeError, scrapeSite } from "@/lib/scrape";
import { mirrorLogoToStorage } from "@/lib/scrape/logo";
import { generateBrandIdentity } from "@/lib/pipeline/brand-identity";
import {
  IMPORT_TOOL,
  buildImportMessages,
  type ImportToolInput,
} from "@/prompts/import-website";
import { stripEmDashes } from "@/lib/text";
import { logError, logWarn } from "@/lib/log";

// Scrape (~45s budget) + one Claude call with a large input can be slow.
export const maxDuration = 300;

const BodySchema = z.object({ url: z.string().min(4).max(2048) });

const clean = (s?: string) => {
  const out = s ? stripEmDashes(s.trim()) : undefined;
  return out || undefined;
};
const cleanList = (l?: string[]) => {
  const out = l?.map((s) => stripEmDashes(s.trim())).filter(Boolean);
  return out?.length ? out : undefined;
};

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/**
 * POST { url }: scrape the site, extract a brand PROPOSAL with Claude, and
 * return it. Performs ZERO database writes; the review UI saves selected
 * sections through the existing settings PATCH routes.
 */
export async function POST(req: NextRequest) {
  if (!isAnthropicConfigured()) {
    return NextResponse.json(
      { error: "Set ANTHROPIC_API_KEY in .env.local." },
      { status: 503 },
    );
  }
  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter a website URL." }, { status: 400 });
  }

  try {
    const data = await getBrandWithIcps();
    if (!data) {
      return NextResponse.json({ error: "No brand found" }, { status: 404 });
    }

    const scrape = await scrapeSite(parsed.data.url);
    const { system, user } = buildImportMessages(scrape);

    const response = await getAnthropic().messages.create({
      model: DRAFT_MODEL,
      max_tokens: 8192,
      system,
      messages: [{ role: "user", content: user }],
      tools: [IMPORT_TOOL],
      tool_choice: { type: "tool", name: "save_brand_extraction" },
    });
    logUsage("import-website", DRAFT_MODEL, response.usage);

    const tu = response.content.find(
      (b) => b.type === "tool_use" && b.name === "save_brand_extraction",
    );
    if (!tu || tu.type !== "tool_use") {
      return NextResponse.json(
        { error: "The model returned nothing. Try again." },
        { status: 502 },
      );
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

    // Products: dedupe by slug, require a name, keep site-evidenced fields.
    const seenSlugs = new Set<string>();
    const products: ProposedProduct[] = [];
    for (const p of raw.products ?? []) {
      const name = clean(p.name);
      if (!name) continue;
      const slug = slugify(clean(p.slug) ?? name);
      if (!slug || seenSlugs.has(slug)) continue;
      seenSlugs.add(slug);
      products.push({
        slug,
        name,
        description: clean(p.description),
        deliverables: cleanList(p.deliverables),
        price_point: clean(p.price_point),
        url: clean(p.url),
      });
    }

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
          brandName: data.brand.name,
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
          "api:/api/settings/import-website:identity-fallback",
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
              logo_alt: clean(raw.logo_alt) ?? data.brand.name,
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

    return NextResponse.json({ proposal });
  } catch (err) {
    if (err instanceof ScrapeError) {
      const status =
        err.code === "invalid_url" || err.code === "blocked_host"
          ? 400
          : err.code === "no_text"
            ? 422
            : 502;
      const message =
        err.code === "no_text"
          ? "We couldn't read any text from this site. It may render entirely with JavaScript. You can fill your profile manually or via the onboarding chat."
          : err.message;
      return NextResponse.json({ error: message }, { status });
    }
    logError("api:/api/settings/import-website", err);
    return NextResponse.json(
      { error: "Import failed. Try again." },
      { status: 500 },
    );
  }
}
