import { NextResponse } from "next/server";
import { getAdminClient, isSupabaseConfigured } from "@/lib/db/client";
import { deleteStyleReference, getSingleBrand, getStyleReference } from "@/lib/db/queries";
import { getSessionUser } from "@/lib/supabase/server";
import { logError } from "@/lib/log";

const BUCKET = "style-references";

/** Deletes a saved style: storage object first (we have its path), then the
 * row. Existing flyers keep rendering; only future generations lose the
 * option (the pipeline treats a missing style reference as "no style"). */
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

    const style = await getStyleReference(id);
    if (!style || style.brand_id !== brand.id) {
      return NextResponse.json({ error: "Style not found." }, { status: 404 });
    }

    const db = getAdminClient();
    const { error: storageErr } = await db.storage
      .from(BUCKET)
      .remove([style.storage_path]);
    if (storageErr) {
      // Non-fatal: an orphaned object is better than a stuck delete.
      logError("api:/api/style-references/[id]:storage", storageErr, { id });
    }

    await deleteStyleReference(id);
    return NextResponse.json({ deleted: true });
  } catch (err) {
    logError("api:/api/style-references/[id]", err, { id });
    return NextResponse.json({ error: "Failed to delete the style." }, { status: 500 });
  }
}
