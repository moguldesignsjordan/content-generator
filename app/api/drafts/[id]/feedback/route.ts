import { NextRequest, NextResponse } from "next/server";
import { setDraftFeedback } from "@/lib/db/queries";
import { requireDraftInBrand } from "@/lib/draft-access";
import { logError } from "@/lib/log";

// Thumbs up/down on a draft. Unlike approve/reject this is judgment-only: it
// never changes the draft's state, it teaches the generator what the user
// likes (recent ratings are injected into the email prompt as liked/disliked
// examples). Tapping the same thumb again sends null to clear it.

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const access = await requireDraftInBrand(id);
    if (!access.ok) return access.response;

    const body = (await req.json().catch(() => ({}))) as {
      feedback?: unknown;
      note?: unknown;
    };
    const feedback =
      body.feedback === "up" || body.feedback === "down" ? body.feedback : null;
    if (feedback === null && body.feedback != null) {
      return NextResponse.json(
        { error: "feedback must be \"up\", \"down\", or null." },
        { status: 400 },
      );
    }
    const note =
      typeof body.note === "string" && body.note.trim()
        ? body.note.trim().slice(0, 300)
        : null;

    await setDraftFeedback(id, feedback, note);
    return NextResponse.json({ ok: true, feedback, note: feedback ? note : null });
  } catch (err) {
    logError("api:/api/drafts/[id]/feedback", err);
    return NextResponse.json(
      { error: "Could not save your rating. Try again." },
      { status: 500 },
    );
  }
}
