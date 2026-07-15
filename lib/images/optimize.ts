import "server-only";
import sharp from "sharp";

// Email-safe image optimization. Targets the 600px email column at 2x
// (1200px source), JPEG only (Outlook and older clients don't render WebP),
// and steps quality down until the file lands under the size budget so a
// hero image never bloats the email into Gmail's ~102KB clip zone territory.

const TARGET_WIDTH = 1200;
const MAX_BYTES = 150 * 1024;
const QUALITY_LADDER = [82, 72, 62, 52, 42];

// PNG's budget ladder is palette quantization instead of JPEG quality.
const PNG_QUALITY_LADDER = [100, 80, 60, 40];

export interface OptimizedImage {
  data: Buffer;
  width: number;
  height: number;
  format: "jpeg" | "png";
}

/**
 * Resizes to the email column width (never enlarging) and compresses under
 * ~150KB. Sources WITH transparency stay PNG (alpha intact — a transparent
 * logo used to come back flattened into a white box); everything else is
 * flattened onto white and encoded as JPEG (Outlook-safe, no WebP).
 */
export async function optimizeEmailImage(input: Buffer): Promise<OptimizedImage> {
  const meta = await sharp(input).metadata();
  const resized = sharp(input)
    .rotate() // honor EXIF orientation
    .resize({ width: TARGET_WIDTH, withoutEnlargement: true });

  if (meta.hasAlpha) {
    const full = await resized.clone().png({ compressionLevel: 9 }).toBuffer();
    let data = full;
    if (full.length > MAX_BYTES) {
      for (const quality of PNG_QUALITY_LADDER) {
        data = await resized.clone().png({ palette: true, quality }).toBuffer();
        if (data.length <= MAX_BYTES) break;
      }
    }
    const outMeta = await sharp(data).metadata();
    return {
      data,
      width: outMeta.width ?? TARGET_WIDTH,
      height: outMeta.height ?? 0,
      format: "png",
    };
  }

  const base = resized.flatten({ background: "#ffffff" });
  for (const quality of QUALITY_LADDER) {
    const data = await base.clone().jpeg({ quality, mozjpeg: true }).toBuffer();
    if (data.length <= MAX_BYTES || quality === QUALITY_LADDER.at(-1)) {
      const outMeta = await sharp(data).metadata();
      return {
        data,
        width: outMeta.width ?? TARGET_WIDTH,
        height: outMeta.height ?? 0,
        format: "jpeg",
      };
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
      return { data, width: target.width, height: target.height, format: "jpeg" };
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
