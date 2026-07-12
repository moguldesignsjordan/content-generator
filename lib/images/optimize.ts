import "server-only";
import sharp from "sharp";

// Email-safe image optimization. Targets the 600px email column at 2x
// (1200px source), JPEG only (Outlook and older clients don't render WebP),
// and steps quality down until the file lands under the size budget so a
// hero image never bloats the email into Gmail's ~102KB clip zone territory.

const TARGET_WIDTH = 1200;
const MAX_BYTES = 150 * 1024;
const QUALITY_LADDER = [82, 72, 62, 52, 42];

export interface OptimizedImage {
  data: Buffer;
  width: number;
  height: number;
}

/**
 * Resizes to the email column width (never enlarging), flattens transparency
 * onto white (JPEG has no alpha), and compresses to JPEG under ~150KB.
 */
export async function optimizeEmailImage(input: Buffer): Promise<OptimizedImage> {
  const base = sharp(input)
    .rotate() // honor EXIF orientation
    .resize({ width: TARGET_WIDTH, withoutEnlargement: true })
    .flatten({ background: "#ffffff" });

  for (const quality of QUALITY_LADDER) {
    const data = await base.clone().jpeg({ quality, mozjpeg: true }).toBuffer();
    if (data.length <= MAX_BYTES || quality === QUALITY_LADDER.at(-1)) {
      const meta = await sharp(data).metadata();
      return { data, width: meta.width ?? TARGET_WIDTH, height: meta.height ?? 0 };
    }
  }
  // Unreachable (the last ladder step always returns), but keeps TS honest.
  throw new Error("Image optimization failed.");
}

// Flyer budgets: a social flyer is a text-bearing designed graphic viewed
// full-screen, so it gets the platform-native pixel box (fit cover, so the
// model's render fills the exact IG shape) and a much looser size budget than
// the email path; crunching typography to 42-quality JPEG makes it illegible.
const FLYER_QUALITY_LADDER = [88, 82, 74];
const FLYER_MAX_BYTES = 500 * 1024;

/**
 * Resizes a rendered flyer to its exact post shape (cover-cropping any small
 * aspect drift from the image model) and compresses to JPEG under ~500KB.
 */
export async function optimizeFlyerImage(
  input: Buffer,
  target: { width: number; height: number },
): Promise<OptimizedImage> {
  const base = sharp(input)
    .rotate()
    .resize({
      width: target.width,
      height: target.height,
      fit: "cover",
      position: "centre",
    })
    .flatten({ background: "#ffffff" });

  for (const quality of FLYER_QUALITY_LADDER) {
    const data = await base.clone().jpeg({ quality, mozjpeg: true }).toBuffer();
    if (data.length <= FLYER_MAX_BYTES || quality === FLYER_QUALITY_LADDER.at(-1)) {
      return { data, width: target.width, height: target.height };
    }
  }
  throw new Error("Image optimization failed.");
}

/**
 * Prepares a user-attached reference image for model input: downscaled to fit
 * 1024px, re-encoded as JPEG, returned base64. Also validates the bytes are a
 * real decodable image (sharp throws on garbage, which we translate).
 */
export async function prepareReferenceImage(
  input: Buffer,
): Promise<{ data: string; mimeType: string }> {
  try {
    const data = await sharp(input)
      .rotate()
      .resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 80, mozjpeg: true })
      .toBuffer();
    return { data: data.toString("base64"), mimeType: "image/jpeg" };
  } catch {
    throw new Error("That reference file isn't a readable image. Try a JPEG or PNG.");
  }
}
