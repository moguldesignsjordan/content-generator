import { NextRequest, NextResponse } from "next/server";
import { fetchBinary } from "@/lib/scrape/fetch-page";
import { optimizeEmailImage } from "@/lib/images/optimize";
import { uploadContentImage } from "@/lib/pipeline/generate-image";
import { createMediaAsset, getSingleBrand } from "@/lib/db/queries";
import { logError } from "@/lib/log";
import { getSessionUser } from "@/lib/supabase/server";

const MAX_BYTES = 10 * 1024 * 1024;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
// Post pages, not images: their HTML needs a login and blocks fetching.
const POST_PAGE = /(^|\.)(instagram\.com|facebook\.com|fb\.com|tiktok\.com|x\.com|twitter\.com|pinterest\.com)$/i;

/**
 * POST { url }: brings a pasted image link into a look. The fetch goes through
 * the website importer's guards (lib/scrape/fetch-page.ts: public hosts only,
 * every redirect re-checked, image content types only, size-capped), then the
 * image is re-hosted on our bucket so the look never depends on someone
 * else's link staying up.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    const brand = await getSingleBrand(user.id);
    if (!brand) return NextResponse.json({ error: "No brand found." }, { status: 404 });

    const { url: raw } = (await req.json().catch(() => ({}))) as { url?: unknown };
    let url: URL;
    try {
      url = new URL(typeof raw === "string" ? raw.trim() : "");
      if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("scheme");
    } catch {
      return NextResponse.json({ error: "Paste a full image link (starting with https://)." }, { status: 400 });
    }
    if (POST_PAGE.test(url.hostname)) {
      return NextResponse.json(
        { error: "That's a post page, which blocks downloads. Take a screenshot and upload it instead." },
        { status: 400 },
      );
    }

    const fetched = await fetchBinary(url, { allowedTypes: IMAGE_TYPES, maxBytes: MAX_BYTES });
    if (!fetched) {
      return NextResponse.json(
        { error: "Couldn't get an image from that link. Make sure it opens straight to a picture, or upload a screenshot." },
        { status: 400 },
      );
    }
    const optimized = await optimizeEmailImage(fetched.bytes);
    const { url: hosted, path } = await uploadContentImage(optimized.data, optimized.format);
    createMediaAsset({
      brandId: brand.id,
      url: hosted,
      storagePath: path,
      alt: "Look example",
      kind: "general",
      source: "uploaded",
      width: optimized.width,
      height: optimized.height,
    }).catch(() => {});
    return NextResponse.json({ url: hosted });
  } catch (err) {
    logError("api:/api/looks/import-url", err);
    return NextResponse.json({ error: "Couldn't import that image." }, { status: 500 });
  }
}
