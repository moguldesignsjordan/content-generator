import { NextRequest, NextResponse } from "next/server";
import { getAdminClient, isSupabaseConfigured } from "@/lib/db/client";
import {
  createStyleReference,
  getSingleBrand,
  listStyleReferences,
} from "@/lib/db/queries";
import type { EmailDesignProfile, StyleReferenceKind } from "@/lib/db/types";
import { extractEmailDesign } from "@/lib/pipeline/extract-design";
import { prepareReferenceImage } from "@/lib/images/optimize";
import { logError } from "@/lib/log";
import sharp from "sharp";

export const maxDuration = 60;

// The reusable reference image library (style_references, migrations 014+016).
// Two kinds share the table and the public `style-references` bucket:
//
//   kind=flyer (default)  a look a flyer can borrow; picked per flyer.
//   kind=email            an email design screenshot; the newest one is
//                         attached to every email generation, whose layout it
//                         recreates. Analyzed once here at upload
//                         (extractEmailDesign) so no draft re-reads the image.
//
// A good-quality original is stored; the pipeline downscales per generation via
// prepareReferenceImage.

const BUCKET = "style-references";
const MAX_BYTES = 10 * 1024 * 1024;

function parseKind(value: FormDataEntryValue | string | null): StyleReferenceKind {
  return String(value ?? "") === "email" ? "email" : "flyer";
}

export async function GET(req: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ styles: [] });
  }
  try {
    const brand = await getSingleBrand();
    if (!brand) return NextResponse.json({ styles: [] });
    const kind = parseKind(req.nextUrl.searchParams.get("kind"));
    const styles = await listStyleReferences(brand.id, kind);
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
    const kind = parseKind(form.get("kind"));

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

    // Read the design once, now, so generation never re-analyzes the image.
    // Non-fatal: a null profile still saves, and the attached image alone is
    // enough to recreate from.
    let designProfile: EmailDesignProfile | null = null;
    if (kind === "email") {
      const prepared = await prepareReferenceImage(normalized).catch(() => null);
      if (prepared) designProfile = await extractEmailDesign(prepared);
    }

    const { data: pub } = db.storage.from(BUCKET).getPublicUrl(path);
    const style = await createStyleReference({
      brandId: brand.id,
      name,
      imageUrl: pub.publicUrl,
      storagePath: path,
      notes: notes || undefined,
      kind,
      // A flyer reference borrows a look; an email reference is rebuilt.
      mode: kind === "email" ? "recreate" : "style",
      designProfile: kind === "email" ? designProfile : undefined,
    });
    return NextResponse.json({ style });
  } catch (err) {
    logError("api:/api/style-references", err);
    const message = err instanceof Error ? err.message : "";
    return NextResponse.json(
      {
        error: /kind|mode|design_profile/.test(message)
          ? "Design library isn't set up yet: apply migration 016 in Supabase."
          : /style_references/.test(message)
            ? "Style library isn't set up yet: apply migration 014 in Supabase."
            : "Failed to save the style.",
      },
      { status: 500 },
    );
  }
}
