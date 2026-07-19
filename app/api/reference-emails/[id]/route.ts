import { NextRequest, NextResponse } from "next/server";
import { isSupabaseConfigured } from "@/lib/db/client";
import { deleteReferenceEmail, getReferenceEmail, getSingleBrand } from "@/lib/db/queries";
import { getSessionUser } from "@/lib/supabase/server";
import { logError } from "@/lib/log";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Not configured." }, { status: 503 });
  }
  try {
    const { id } = await params;
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
    const brand = await getSingleBrand(user.id);
    if (!brand) {
      return NextResponse.json({ error: "No brand found." }, { status: 404 });
    }
    const reference = await getReferenceEmail(id);
    if (!reference || reference.brand_id !== brand.id) {
      return NextResponse.json({ error: "Reference email not found." }, { status: 404 });
    }
    await deleteReferenceEmail(id);
    return NextResponse.json({ deleted: true });
  } catch (err) {
    logError("api:/api/reference-emails:delete", err);
    return NextResponse.json(
      { error: "Couldn't delete the reference email." },
      { status: 500 },
    );
  }
}
