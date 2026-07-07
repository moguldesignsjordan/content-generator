import { NextRequest, NextResponse } from "next/server";
import { redesignEmail } from "@/lib/pipeline/redesign";
import { logError } from "@/lib/log";

// No thinking, no copywriting: cheap despite regenerating the whole
// document, but leave headroom for a slow model turn or the Sonnet fallback.
export const maxDuration = 120;

/**
 * POST { direction? }: instantly redesigns the draft's full HTML using the
 * CURRENT brand tokens as the default, keeping the exact same copy. Fixes
 * drift between the design and brand colors that a single find/replace
 * patch can't reach (the same color often appears as several different
 * literal shades across sections). An optional direction lets the user
 * explicitly override the brand default for this one redesign (e.g. "make
 * it darker, purple accent instead"), taking priority over brand tokens for
 * whatever it specifies.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { direction } = (await req.json().catch(() => ({}))) as {
      direction?: string;
    };
    const result = await redesignEmail(id, direction?.trim() || undefined);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 502 });
    }
    return NextResponse.json({ html: result.html, history: result.history });
  } catch (err) {
    logError("api:/api/drafts/[id]/redesign", err);
    return NextResponse.json({ error: "Redesign failed. Try again." }, { status: 500 });
  }
}
