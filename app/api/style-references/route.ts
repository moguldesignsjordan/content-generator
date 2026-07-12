import { NextRequest, NextResponse } from "next/server";
import { getAdminClient, isSupabaseConfigured } from "@/lib/db/client";
import {
  createStyleReference,
  getSingleBrand,
  listStyleReferences,
} from "@/lib/db/queries";
import { logError } from "@/lib/log";
import sharp from "sharp";

export const maxDuration = 60;

// The reusable flyer style library (style_references, migration 014): upload
// a reference image once, pick it on any flyer. Stored on the public
// `style-references` bucket; the pipeline downscales it per generation via
// prepareReferenceImage, so we keep a good-quality original here.

const BUCKET = "style-references";
const MAX_BYTES = 10 * 1024 * 1024;

export async function GET() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ styles: [] });
  }
  try {
    const brand = await getSingleBrand();
    if (!brand) return NextResponse.json({ styles: [] });
    const styles = await listStyleReferences(brand.id);
    return NextResponse.json({ styles });
  } catch (err) {
    logError("api:/api/style-references:list", err);
    return NextResponse.json({ error: "Couldn't load styles." }, { status: 500 });
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
    const file = form.get("file");
    const name = String(form.get("name") ?? "").trim();
    const notes = String(form.get("notes") ?? "").trim();

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No image provided." }, { status: 400 });
    }
    if (!file.type.startsWith("image/")) {
      return NextResponse.json(
        { error: "Unsupported file type. Use a JPEG, PNG, or WebP image." },
        { status: 400 },
      );
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "File too large. Max 10MB." }, { status: 400 });
    }
    if (!name) {
      return NextResponse.json({ error: "Give the style a name." }, { status: 400 });
    }

    const brand = await getSingleBrand();
    if (!brand) {
      return NextResponse.json({ error: "No brand found." }, { status: 404 });
    }

    // Normalize to a bounded JPEG (also validates the bytes decode).
    let normalized: Buffer;
    try {
      normalized = await sharp(Buffer.from(await file.arrayBuffer()))
        .rotate()
        .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
        .flatten({ background: "#ffffff" })
        .jpeg({ quality: 88, mozjpeg: true })
        .toBuffer();
    } catch {
      return NextResponse.json(
        { error: "That file isn't a readable image. Try a JPEG or PNG." },
        { status: 400 },
      );
    }

    const db = getAdminClient();
    const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
    let { error: upErr } = await db.storage.from(BUCKET).upload(path, normalized, {
      contentType: "image/jpeg",
      cacheControl: "31536000",
      upsert: false,
    });
    if (upErr && /bucket/i.test(upErr.message)) {
      // Self-heal: the first-ever style creates the bucket, same pattern as
      // uploadContentImage in lib/pipeline/generate-image.ts.
      await db.storage.createBucket(BUCKET, { public: true }).catch(() => {});
      ({ error: upErr } = await db.storage.from(BUCKET).upload(path, normalized, {
        contentType: "image/jpeg",
        cacheControl: "31536000",
        upsert: false,
      }));
    }
    if (upErr) {
      logError("api:/api/style-references:storage", upErr);
      return NextResponse.json(
        { error: "Couldn't save the style image. Try again." },
        { status: 500 },
      );
    }

    const { data: pub } = db.storage.from(BUCKET).getPublicUrl(path);
    const style = await createStyleReference({
      brandId: brand.id,
      name,
      imageUrl: pub.publicUrl,
      storagePath: path,
      notes: notes || undefined,
    });
    return NextResponse.json({ style });
  } catch (err) {
    logError("api:/api/style-references", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error && /style_references/.test(err.message)
            ? "Style library isn't set up yet: apply migration 014 in Supabase."
            : "Failed to save the style.",
      },
      { status: 500 },
    );
  }
}
