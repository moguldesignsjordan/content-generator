import { NextResponse } from "next/server";
import { getAdminClient, isSupabaseConfigured } from "@/lib/db/client";
import { deleteMediaAsset, getMediaAsset, getSingleBrand } from "@/lib/db/queries";
import { logError } from "@/lib/log";
import { getSessionUser } from "@/lib/supabase/server";

const BUCKET = "content-images";

/** Deletes a saved media asset: storage object first (we have its path), then
 * the row. Drafts that already used this image keep rendering (they store the
 * URL directly); only future reuse loses the option. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Missing configuration. Set SUPABASE_* in .env.local." },
      { status: 503 },
    );
  }

  const { id } = await params;
  try {
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
    const brand = await getSingleBrand(user.id);
    if (!brand) {
      return NextResponse.json({ error: "No brand found." }, { status: 404 });
    }

    const asset = await getMediaAsset(id);
    if (!asset || asset.brand_id !== brand.id) {
      return NextResponse.json({ error: "Image not found." }, { status: 404 });
    }

    const db = getAdminClient();
    const { error: storageErr } = await db.storage
      .from(BUCKET)
      .remove([asset.storage_path]);
    if (storageErr) {
      // Non-fatal: an orphaned object is better than a stuck delete.
      logError("api:/api/media/[id]:storage", storageErr, { id });
    }

    await deleteMediaAsset(id);
    return NextResponse.json({ deleted: true });
  } catch (err) {
    logError("api:/api/media/[id]", err, { id });
    return NextResponse.json({ error: "Failed to delete the image." }, { status: 500 });
  }
}
