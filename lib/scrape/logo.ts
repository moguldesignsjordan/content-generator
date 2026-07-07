import "server-only";
import { getAdminClient } from "@/lib/db/client";
import { fetchBinary } from "./fetch-page";
import { logWarn } from "@/lib/log";

// Mirrors the best scraped logo into the public `logos` Storage bucket (same
// contract as /api/settings/upload-logo: limits match, orphaned objects on
// abandoned imports are acceptable in v1). A mirrored copy gives the review
// UI a renderable image and the brand a stable URL instead of a hotlink.

const ALLOWED = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];
const MAX_BYTES = 2 * 1024 * 1024;

const EXT_BY_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};

/**
 * Tries logo candidate URLs in order; the first that downloads within limits
 * is uploaded to the logos bucket. Returns the public URL and which source
 * URL won, or null when every candidate fails (the proposal just has no logo).
 */
export async function mirrorLogoToStorage(
  candidates: string[],
): Promise<{ url: string; sourceUrl: string } | null> {
  for (const sourceUrl of candidates.slice(0, 6)) {
    let parsed: URL;
    try {
      parsed = new URL(sourceUrl);
    } catch {
      continue;
    }
    const img = await fetchBinary(parsed, {
      allowedTypes: ALLOWED,
      maxBytes: MAX_BYTES,
    });
    if (!img || !img.bytes.byteLength) continue;

    const ext = EXT_BY_TYPE[img.contentType] ?? "png";
    const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const db = getAdminClient();
    const { error } = await db.storage.from("logos").upload(path, img.bytes, {
      contentType: img.contentType,
      cacheControl: "3600",
      upsert: false,
    });
    if (error) {
      logWarn("scrape:logo", `upload failed: ${error.message}`);
      return null; // storage problem, not a candidate problem: stop trying
    }
    const { data } = db.storage.from("logos").getPublicUrl(path);
    return { url: data.publicUrl, sourceUrl };
  }
  return null;
}
