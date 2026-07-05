import { NextRequest, NextResponse } from "next/server";
import { adjustCopy } from "@/lib/pipeline/adjust-copy";
import type { CopyMode } from "@/prompts/adjust-copy";

// Inline wording edit on one region: cheap, no thinking, but leave headroom
// for a slow model turn or the Sonnet fallback. Sibling to /adjust-style.
export const maxDuration = 120;

/**
 * POST { region, regionLabel, snippet, mode, newText?, instruction? }: edits
 * the WORDING of the clicked region in place (no new draft version). `mode:
 * "edit"` swaps in the user's `newText` verbatim; `mode: "regenerate"`
 * rewrites the region's text, optionally shaped by `instruction`.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as {
      region?: string;
      regionLabel?: string;
      snippet?: string;
      mode?: string;
      newText?: string;
      instruction?: string;
    };

    if (!body.region || !body.regionLabel || !body.snippet) {
      return NextResponse.json(
        { error: "Which part of the email are you editing?" },
        { status: 400 },
      );
    }
    const mode: CopyMode = body.mode === "regenerate" ? "regenerate" : "edit";
    if (mode === "edit" && !body.newText?.trim()) {
      return NextResponse.json({ error: "Write some new text." }, { status: 400 });
    }

    const result = await adjustCopy(id, {
      regionCtx: {
        region: body.region,
        label: body.regionLabel,
        snippet: body.snippet,
      },
      mode,
      newText: body.newText,
      instruction: body.instruction?.trim() || undefined,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 502 });
    }
    return NextResponse.json({
      html: result.html,
      history: result.history,
      caveat: result.caveat,
    });
  } catch (err) {
    console.error("[copy] error", err);
    return NextResponse.json(
      { error: "Couldn't apply that edit. Try again." },
      { status: 500 },
    );
  }
}
