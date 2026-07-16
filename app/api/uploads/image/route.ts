import { NextRequest, NextResponse } from "next/server";
import { optimizeEmailImage } from "@/lib/images/optimize";
import { uploadContentImage } from "@/lib/pipeline/generate-image";
import { createMediaAsset, getSingleBrand } from "@/lib/db/queries";
import type { MediaAssetKind } from "@/lib/db/types";
import { getSessionUser } from "@/lib/supabase/server";
import { logError } from "@/lib/log";

// Generic authenticated image upload, hosted on the same content-images
// bucket generated heroes use. Shared by anywhere a real photo (a product
// shot, a flyer reference) needs a stable hosted URL before a draft or a
// campaign brief exists to attach it to. No AI involved. Every upload is
// recorded in the media library (migration 024) so it can be browsed and
// reused later; an optional `kind` field tags what it's for.

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const KINDS: MediaAssetKind[] = ["hero", "flyer", "product", "general"];

export async function POST(req: NextRequest) {
  try {
    const sessionUser = await getSessionUser();
    if (!sessionUser) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: "Attach an image to upload." }, { status: 400 });
    }
    if (!file.type.startsWith("image/")) {
      return NextResponse.json(
        { error: "Only image files work here (JPEG, PNG, WebP)." },
        { status: 400 },
      );
    }
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: "That image is over 10MB. Use a smaller file." }, {
        status: 400,
      });
    }
    const rawKind = form?.get("kind") as string | null;
    const kind: MediaAssetKind = KINDS.includes(rawKind as MediaAssetKind)
      ? (rawKind as MediaAssetKind)
      : "general";
    const alt = (form?.get("alt") as string | null)?.trim() || null;

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

    const brand = await getSingleBrand(sessionUser.id).catch(() => null);
    if (brand) {
      createMediaAsset({
        brandId: brand.id,
        url,
        storagePath: path,
        alt,
        kind,
        source: "uploaded",
        width: optimized.width,
        height: optimized.height,
      }).catch((err) => logError("api:/api/uploads/image:record-media-asset", err));
    }

    return NextResponse.json({ url, width: optimized.width, height: optimized.height });
  } catch (err) {
    logError("api:/api/uploads/image", err);
    return NextResponse.json({ error: "Couldn't upload that image. Try again." }, { status: 500 });
  }
}
