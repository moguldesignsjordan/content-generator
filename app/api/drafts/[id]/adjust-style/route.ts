import { NextRequest, NextResponse } from "next/server";
import { adjustEmailStyle } from "@/lib/pipeline/adjust-style";

// No thinking, no copy regeneration: comfortably faster than the full
// generation/regeneration routes, but leaves headroom for a slow model turn.
export const maxDuration = 120;

/**
 * POST { instruction }: applies a natural-language style edit to the
 * CURRENT draft's HTML in place (no new draft version). For "change the
 * header to a gradient" style requests, distinct from reject & regenerate
 * (which rewrites copy and creates a new version).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { instruction } = (await req.json()) as { instruction?: string };
    if (!instruction?.trim()) {
      return NextResponse.json(
        { error: "Describe the change you want." },
        { status: 400 },
      );
    }

    const result = await adjustEmailStyle(id, instruction.trim());
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 502 });
    }
    return NextResponse.json({ html: result.html });
  } catch (err) {
    console.error("[adjust-style] error", err);
    return NextResponse.json(
      { error: "Couldn't apply that change. Try again." },
      { status: 500 },
    );
  }
}
