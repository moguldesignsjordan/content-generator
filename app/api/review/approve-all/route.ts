import { NextRequest, NextResponse } from "next/server";
import { getSingleBrand } from "@/lib/db/queries";
import { approveReadyDrafts } from "@/lib/pipeline/approve-batch";
import { logError } from "@/lib/log";
import { getSessionUser } from "@/lib/supabase/server";

/**
 * POST { draftIds }: approves the listed drafts from the Review page that are
 * finished and still waiting (see approveReadyDrafts for what's skipped).
 * Only the caller's brand's drafts are ever touched.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { draftIds?: unknown };
    const draftIds = Array.isArray(body.draftIds)
      ? body.draftIds.filter((v): v is string => typeof v === "string").slice(0, 100)
      : [];
    if (!draftIds.length) {
      return NextResponse.json({ error: "Nothing to approve." }, { status: 400 });
    }
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    const brand = await getSingleBrand(user.id);
    if (!brand) return NextResponse.json({ error: "No brand found." }, { status: 404 });

    const result = await approveReadyDrafts(
      brand.id,
      draftIds,
      brand.voice_profile?.banned_terms ?? [],
    );
    return NextResponse.json(result);
  } catch (err) {
    logError("api:/api/review/approve-all", err);
    return NextResponse.json({ error: "Couldn't approve them. Try again." }, { status: 500 });
  }
}
