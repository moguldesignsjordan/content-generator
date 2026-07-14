import { NextRequest, NextResponse } from "next/server";
import { isSupabaseConfigured } from "@/lib/db/client";
import { deleteReferenceEmail } from "@/lib/db/queries";
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
