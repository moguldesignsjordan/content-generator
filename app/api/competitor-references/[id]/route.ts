import { NextResponse } from "next/server";
import { getAdminClient, isSupabaseConfigured } from "@/lib/db/client";
import {
  deleteCompetitorReference,
  getCompetitorReference,
  getSingleBrand,
} from "@/lib/db/queries";
import { getSessionUser } from "@/lib/supabase/server";
import { logError } from "@/lib/log";

const BUCKET = "content-images";

/** Deletes a saved competitor ad: its storage object first when it's an
 * image row (we have its path), then the row. Drafts already generated with
 * it keep their content; only future generations lose the option (a missing
 * competitor_reference_id just means no reference for that draft). */
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

    const reference = await getCompetitorReference(id);
    if (!reference || reference.brand_id !== brand.id) {
      return NextResponse.json({ error: "Competitor ad not found." }, { status: 404 });
    }

    if (reference.input_kind === "image" && reference.storage_path) {
      const db = getAdminClient();
      const { error: storageErr } = await db.storage
        .from(BUCKET)
        .remove([reference.storage_path]);
      if (storageErr) {
        // Non-fatal: an orphaned object is better than a stuck delete.
        logError("api:/api/competitor-references/[id]:storage", storageErr, { id });
      }
    }

    await deleteCompetitorReference(id);
    return NextResponse.json({ deleted: true });
  } catch (err) {
    logError("api:/api/competitor-references/[id]", err, { id });
    return NextResponse.json(
      { error: "Failed to delete the competitor ad." },
      { status: 500 },
    );
  }
}
