import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/db/client";
import { logError } from "@/lib/log";

export const maxDuration = 60;

const ALLOWED = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];
const MAX_BYTES = 2 * 1024 * 1024; // 2MB

/**
 * Uploads a logo file to the public `logos` Storage bucket and returns its
 * public URL. Does NOT touch the brands row, the client receives the URL and
 * includes it in the visual-identity PATCH on Save. (v1 single-brand: orphaned
 * objects on abandoned uploads are acceptable.)
 */
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    if (!ALLOWED.includes(file.type)) {
      return NextResponse.json(
        { error: "Unsupported file type. Use PNG, JPG, WebP, or SVG." },
        { status: 400 },
      );
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: "File too large. Max 2MB." },
        { status: 400 },
      );
    }

    const ext = file.name.split(".").pop()?.toLowerCase() ?? "png";
    const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

    const db = getAdminClient();
    const { error: upErr } = await db.storage
      .from("logos")
      .upload(path, file, {
        contentType: file.type,
        cacheControl: "3600",
        upsert: false,
      });
    if (upErr) {
      logError("api:/api/settings/upload-logo:storage", upErr);
      return NextResponse.json(
        { error: "Upload failed. Is the `logos` bucket created in Supabase?" },
        { status: 500 },
      );
    }

    const { data } = db.storage.from("logos").getPublicUrl(path);
    return NextResponse.json({ url: data.publicUrl });
  } catch (err) {
    logError("api:/api/settings/upload-logo", err);
    return NextResponse.json({ error: "Failed to upload logo" }, { status: 500 });
  }
}
