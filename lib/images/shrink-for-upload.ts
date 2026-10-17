// Vercel rejects function request bodies over 4.5MB with a 413 before the
// route runs, and phone photos are routinely bigger. The server resizes to
// 1200px anyway (lib/images/optimize.ts), so scaling down here loses nothing.

const UPLOAD_LIMIT_BYTES = 4 * 1024 * 1024;
const MAX_EDGE = 2400;

/** Returns the file untouched when it already fits, else a downscaled copy. */
export async function shrinkForUpload(file: File): Promise<File> {
  if (file.size <= UPLOAD_LIMIT_BYTES || file.type === "image/svg+xml" || file.type === "image/gif") {
    return file;
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  // JPEG drops transparency, so non-JPEG sources try WebP first. Safari can't
  // encode WebP and hands back a PNG that may still be too big, hence JPEG last.
  const types = file.type === "image/jpeg" ? ["image/jpeg"] : ["image/webp", "image/jpeg"];
  for (const type of types) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.9));
    if (blob && blob.size <= UPLOAD_LIMIT_BYTES) {
      const name = `${file.name.replace(/\.[^.]+$/, "")}.${blob.type.split("/")[1]}`;
      return new File([blob], name, { type: blob.type });
    }
  }
  return file;
}
