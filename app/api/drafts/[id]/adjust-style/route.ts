import { NextRequest, NextResponse } from "next/server";
import {
  adjustEmailStyle,
  getStyleEditHistory,
  undoLastStyleEdit,
} from "@/lib/pipeline/adjust-style";

// No thinking, no copy regeneration: comfortably faster than the full
// generation/regeneration routes, but leaves headroom for a slow model turn.
export const maxDuration = 120;

/**
 * GET: returns the current html + undo history. The client calls this on
 * mount so the design-chat panel's history/undo state is server-authoritative
 * and survives a page reload, instead of living only in React state.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const result = await getStyleEditHistory(id);
    if (!result) {
      return NextResponse.json({ error: "Draft not found." }, { status: 404 });
    }
    return NextResponse.json(result);
  } catch (err) {
    console.error("[adjust-style] GET error", err);
    return NextResponse.json({ error: "Couldn't load history." }, { status: 500 });
  }
}

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
    const { instruction, region, regionLabel, snippet } = (await req.json()) as {
      instruction?: string;
      region?: string;
      regionLabel?: string;
      snippet?: string;
    };
    if (!instruction?.trim()) {
      return NextResponse.json(
        { error: "Describe the change you want." },
        { status: 400 },
      );
    }

    const regionCtx =
      region && regionLabel && snippet
        ? { region, label: regionLabel, snippet }
        : undefined;

    const result = await adjustEmailStyle(id, instruction.trim(), regionCtx);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 502 });
    }
    return NextResponse.json({
      html: result.html,
      history: result.history,
      caveat: result.caveat,
    });
  } catch (err) {
    console.error("[adjust-style] error", err);
    return NextResponse.json(
      { error: "Couldn't apply that change. Try again." },
      { status: 500 },
    );
  }
}

/**
 * DELETE: undoes the most recent style edit, restoring the previous html.
 * Server-authoritative, so it works even if you reloaded since applying it.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const result = await undoLastStyleEdit(id);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ html: result.html, history: result.history });
  } catch (err) {
    console.error("[adjust-style] DELETE error", err);
    return NextResponse.json({ error: "Couldn't undo. Try again." }, { status: 500 });
  }
}
