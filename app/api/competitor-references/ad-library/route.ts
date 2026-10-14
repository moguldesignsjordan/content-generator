import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isSupabaseConfigured } from "@/lib/db/client";
import {
  createCompetitorReference,
  getSingleBrand,
  listCompetitorReferences,
} from "@/lib/db/queries";
import { adLibraryAdUrl } from "@/lib/clients/scrapecreators";
import { extractCompetitorProfile } from "@/lib/pipeline/extract-competitor";
import { optimizeEmailImage } from "@/lib/images/optimize";
import { uploadContentImage } from "@/lib/pipeline/generate-image";
import { logError } from "@/lib/log";
import { getSessionUser } from "@/lib/supabase/server";
import type { CompetitorReference } from "@/lib/db/types";

// Step 2 of the Ad Library import: save the ads the user picked from the
// preview, each as its own competitor_references row. The ad's image is
// re-hosted on our bucket (Meta's CDN links are signed and expire) and the
// strategy is distilled from image + copy together, once, like every other
// save path in app/api/competitor-references/route.ts.
export const maxDuration = 120;

const MAX_ADS = 10;
const CONCURRENCY = 3;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

// The ads come back from the client, so they're re-validated here. The image
// host is pinned to Meta's CDN so this route can't be used to fetch arbitrary URLs.
const adSchema = z.object({
  adArchiveId: z.string().regex(/^\d+$/),
  pageName: z.string().max(200),
  bodyText: z.string().max(5000),
  headline: z.string().max(500),
  linkDescription: z.string().max(500),
  ctaText: z.string().max(100),
  imageUrl: z
    .string()
    .url()
    .refine((u) => {
      const url = new URL(u);
      return url.protocol === "https:" && /(^|\.)fbcdn\.net$/i.test(url.hostname);
    })
    .nullable(),
  isVideo: z.boolean(),
});
const bodySchema = z.object({ ads: z.array(adSchema).min(1).max(MAX_ADS) });

type PickedAd = z.infer<typeof adSchema>;

function adContent(ad: PickedAd): string {
  return [
    ad.isVideo ? "(Video ad; the image is its preview frame.)" : "",
    ad.bodyText ? `Primary text: ${ad.bodyText}` : "",
    ad.headline ? `Headline: ${ad.headline}` : "",
    ad.linkDescription ? `Description: ${ad.linkDescription}` : "",
    ad.ctaText ? `CTA button: ${ad.ctaText}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function adName(ad: PickedAd): string {
  const label = ad.headline || ad.bodyText.split(/\s+/).slice(0, 6).join(" ") || "Ad";
  return `${ad.pageName || "Competitor"}: ${label}`.slice(0, 80);
}

async function rehostImage(imageUrl: string): Promise<{ url: string; path: string } | null> {
  try {
    const res = await fetch(imageUrl, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return null;
    const data = Buffer.from(await res.arrayBuffer());
    if (data.length > MAX_IMAGE_BYTES) return null;
    const optimized = await optimizeEmailImage(data);
    return await uploadContentImage(optimized.data, optimized.format);
  } catch (err) {
    logError("api:/api/competitor-references/ad-library:image", err);
    return null;
  }
}

async function saveAd(brandId: string, ad: PickedAd): Promise<CompetitorReference> {
  const image = ad.imageUrl ? await rehostImage(ad.imageUrl) : null;
  const content = adContent(ad);
  const competitorProfile = await extractCompetitorProfile({
    content: content || undefined,
    imageUrl: image?.url,
  });
  return createCompetitorReference({
    brandId,
    name: adName(ad),
    inputKind: image ? "image" : "text",
    content: content || null,
    imageUrl: image?.url ?? null,
    storagePath: image?.path ?? null,
    sourceUrl: adLibraryAdUrl(ad.adArchiveId),
    competitorProfile,
  });
}

export async function POST(req: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Missing configuration. Set SUPABASE_* in .env.local." },
      { status: 503 },
    );
  }

  try {
    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: `Pick between 1 and ${MAX_ADS} ads to save.` },
        { status: 400 },
      );
    }

    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
    const brand = await getSingleBrand(user.id);
    if (!brand) {
      return NextResponse.json({ error: "No brand found." }, { status: 404 });
    }

    const existing = await listCompetitorReferences(brand.id);
    const savedUrls = new Set(existing.map((r) => r.source_url).filter(Boolean));
    const queue = parsed.data.ads.filter(
      (ad) => !savedUrls.has(adLibraryAdUrl(ad.adArchiveId)),
    );

    const references: CompetitorReference[] = [];
    const savedIds: string[] = [];
    let failed = 0;
    async function worker() {
      for (let ad = queue.shift(); ad; ad = queue.shift()) {
        try {
          references.push(await saveAd(brand!.id, ad));
          savedIds.push(ad.adArchiveId);
        } catch (err) {
          failed++;
          logError("api:/api/competitor-references/ad-library:save", err, {
            adArchiveId: ad.adArchiveId,
          });
        }
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));

    return NextResponse.json({ references, savedIds, failed });
  } catch (err) {
    logError("api:/api/competitor-references/ad-library", err);
    return NextResponse.json({ error: "Couldn't save those ads." }, { status: 500 });
  }
}
