import { NextRequest, NextResponse } from "next/server";
import { adjustColor } from "@/lib/pipeline/adjust-color";

// Inline color edit on one region: cheap, no thinking, but leave headroom
// for a slow model turn or the Sonnet fallback. Sibling to /copy and
// /adjust-style.
export const maxDuration = 120;

/**
 * POST { region, regionLabel, snippet, hex }: recolors the clicked region to
 * the exact hex color in place (no new draft version).
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
      hex?: string;
    };

    if (!body.region || !body.regionLabel || !body.snippet) {
      return NextResponse.json(
        { error: "Which part of the email are you editing?" },
        { status: 400 },
      );
    }
    if (!body.hex?.trim()) {
      return NextResponse.json({ error: "Pick a color." }, { status: 400 });
    }

    const result = await adjustColor(id, {
      regionCtx: {
        region: body.region,
        label: body.regionLabel,
        snippet: body.snippet,
      },
      hex: body.hex.trim(),
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
    console.error("[color] error", err);
    return NextResponse.json(
      { error: "Couldn't apply that color. Try again." },
      { status: 500 },
    );
  }
}
