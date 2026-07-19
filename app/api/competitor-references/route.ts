import { NextRequest, NextResponse } from "next/server";
import { isSupabaseConfigured } from "@/lib/db/client";
import {
  createCompetitorReference,
  getSingleBrand,
  listCompetitorReferences,
} from "@/lib/db/queries";
import { extractCompetitorProfile } from "@/lib/pipeline/extract-competitor";
import { optimizeEmailImage } from "@/lib/images/optimize";
import { uploadContentImage } from "@/lib/pipeline/generate-image";
import { scrapeCompetitorAdUrl } from "@/lib/scrape";
import { emailHtmlToText } from "@/lib/text";
import { logError } from "@/lib/log";
import { getSessionUser } from "@/lib/supabase/server";

// The competitor ad swipe file (competitor_references, migration 025): save a
// competitor ad you want to learn the STRATEGY from, never the wording.
// Three input paths land in one table (input_kind discriminator, the 016
// "one table, kind discriminator" precedent):
//   - pasted ad copy (content)
//   - an uploaded screenshot (file), hosted on the same content-images bucket
//     generated heroes use
//   - a URL (source_url only), server-scraped; a login-walled/JS page like
//     Facebook Ad Library returns guidance instead of junk (see
//     lib/scrape/scrapeCompetitorAdUrl)
// Claude distills the strategy once here, and every email generation injects
// the result (see buildCompetitorReferenceBlock) instead of re-analyzing the
// raw ad. One Claude call per save, so maxDuration covers it.
export const maxDuration = 60;

const MAX_CONTENT_CHARS = 12000;
const MIN_CONTENT_CHARS = 10;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export async function GET() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ references: [] });
  }
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ references: [] });
    const brand = await getSingleBrand(user.id);
    if (!brand) return NextResponse.json({ references: [] });
    const references = await listCompetitorReferences(brand.id);
    return NextResponse.json({ references });
  } catch (err) {
    logError("api:/api/competitor-references:list", err);
    return NextResponse.json(
      { error: "Couldn't load your competitor ads." },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Missing configuration. Set SUPABASE_* in .env.local." },
      { status: 503 },
    );
  }

  try {
    const form = await req.formData();
    const name = String(form.get("name") ?? "").trim();
    const file = form.get("file");
    const rawContent = String(form.get("content") ?? "").trim();
    const sourceUrl = String(form.get("source_url") ?? "").trim();

    if (!name) {
      return NextResponse.json({ error: "Give the ad a name." }, { status: 400 });
    }

    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
    const brand = await getSingleBrand(user.id);
    if (!brand) {
      return NextResponse.json({ error: "No brand found." }, { status: 404 });
    }

    // Path 1: an uploaded screenshot.
    if (file instanceof File) {
      if (!file.type.startsWith("image/")) {
        return NextResponse.json(
          { error: "Unsupported file type. Use a JPEG, PNG, or WebP image." },
          { status: 400 },
        );
      }
      if (file.size > MAX_IMAGE_BYTES) {
        return NextResponse.json({ error: "File too large. Max 10MB." }, { status: 400 });
      }
      let optimized;
      try {
        optimized = await optimizeEmailImage(Buffer.from(await file.arrayBuffer()));
      } catch {
        return NextResponse.json(
          { error: "That file isn't a readable image. Try a JPEG or PNG." },
          { status: 400 },
        );
      }
      const { url, path } = await uploadContentImage(optimized.data, optimized.format);

      // Distill once, now; null (extraction hiccup) still saves the raw
      // screenshot, which is a usable reference on its own.
      const competitorProfile = await extractCompetitorProfile({ imageUrl: url });

      const reference = await createCompetitorReference({
        brandId: brand.id,
        name,
        inputKind: "image",
        imageUrl: url,
        storagePath: path,
        sourceUrl: sourceUrl || null,
        competitorProfile,
      });
      return NextResponse.json({ reference });
    }

    // Path 2: pasted ad copy.
    if (rawContent) {
      const content = emailHtmlToText(rawContent).slice(0, MAX_CONTENT_CHARS);
      if (content.length < MIN_CONTENT_CHARS) {
        return NextResponse.json(
          { error: "Paste the ad's copy first." },
          { status: 400 },
        );
      }
      const competitorProfile = await extractCompetitorProfile({ content });
      const reference = await createCompetitorReference({
        brandId: brand.id,
        name,
        inputKind: "text",
        content,
        sourceUrl: sourceUrl || null,
        competitorProfile,
      });
      return NextResponse.json({ reference });
    }

    // Path 3: a URL only, server-scraped.
    if (sourceUrl) {
      const scraped = await scrapeCompetitorAdUrl(sourceUrl);
      if (!scraped.ok) {
        return NextResponse.json({ error: scraped.guidance }, { status: 400 });
      }
      const competitorProfile = await extractCompetitorProfile({ content: scraped.content });
      const reference = await createCompetitorReference({
        brandId: brand.id,
        name,
        inputKind: "text",
        content: scraped.content,
        sourceUrl,
        competitorProfile,
      });
      return NextResponse.json({ reference });
    }

    return NextResponse.json(
      { error: "Paste the ad's copy, upload a screenshot, or give a URL." },
      { status: 400 },
    );
  } catch (err) {
    logError("api:/api/competitor-references:create", err);
    const message = err instanceof Error ? err.message : "";
    return NextResponse.json(
      {
        error: /competitor_references/.test(message)
          ? "Competitor ad library isn't set up yet: apply migration 025 in Supabase."
          : "Couldn't save that competitor ad.",
      },
      { status: 500 },
    );
  }
}
